import { test, expect, uploadFile, getFiles, openEditor, openFilesTab } from './fixtures';

// Minimal-but-valid PNG: 8-byte signature + a few zero bytes (server's
// ContentValidator just sniffs the magic).
const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0),
]);

/**
 * Gap 2 verification (FE_INTEGRATION_REVIEW.md): the per-row Replace action
 * in FilesTree POSTs to /api/documents/{id}/files/{oldFileId}/replace via
 * the previously-unwired generated client.
 *
 * Before the fix the receiver-half (banner + file_event handler) worked,
 * but there was no UI to *initiate* a replace.
 *
 * This is a self-replace test (current user does both upload and replace),
 * so the banner is intentionally skipped by editorSession's self-replace
 * short-circuit. The assertion is: the old file is gone and the new file
 * (different type) is present.
 */
test('Replace button initiates a cross-type file replace', async ({ page, docId }) => {
  const request = page.context().request;

  // 1. Setup: upload an image so we have a row with a Replace button.
  await uploadFile(request, docId, 'logo.png', PNG_HEADER, 'image/png');
  const before = await getFiles(request, docId);
  const png = before.find((f) => f.filename === 'logo.png');
  expect(png, 'logo.png should exist after upload').toBeTruthy();
  expect(png!.category).toBe('image');

  // 2. Open the editor + Files tab.
  await openEditor(page, docId);
  await openFilesTab(page);

  // The action buttons are opacity-0 by default and reveal on group-hover.
  // Hover the file row so they become clickable.
  const fileRow = page
    .locator('div.group', { hasText: 'logo.png' })
    .first();
  await fileRow.hover();

  // 3. Click the Replace button. We use the aria-label set on the button.
  const replaceButton = fileRow.getByRole('button', {
    name: /Replace file logo\.png/i,
  });
  await expect(replaceButton).toBeVisible();

  // 4. Click the Replace button. It sets the target ref and programmatically
  // clicks the hidden input, which raises a filechooser event. Playwright's
  // documented pattern is waitForEvent('filechooser') -> setFiles.
  const fileChooserPromise = page.waitForEvent('filechooser');
  await replaceButton.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'logo.tex',
    mimeType: 'text/plain',
    buffer: Buffer.from('% replaced as latex\n\\section{Hi}\n'),
  });

  // 5. Wait for the success toast — sonner renders it in a portal as text.
  await expect(page.getByText(/Replaced "logo\.png"/i)).toBeVisible({
    timeout: 15_000,
  });

  // 6. Assert the backend state — logo.png is gone, logo.tex is now there
  // and is collaborative (cross-type from image to collaborative).
  await expect
    .poll(
      async () => {
        const after = await getFiles(request, docId);
        return after
          .filter((f) => !f.filename.startsWith('__restore_'))
          .map((f) => `${f.filename}:${f.category}:${f.isCollaborative}`)
          .sort();
      },
      { timeout: 15_000 },
    )
    .toEqual([
      'logo.tex:collaborative:true',
      'main.tex:collaborative:true',
    ]);
});
