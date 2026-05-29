import {
  test,
  expect,
  uploadFile,
  getFiles,
  openEditor,
  openInfoTab,
} from './fixtures';

/**
 * Gap 1 verification (FE_INTEGRATION_REVIEW.md): the "Restore" button in
 * DocumentVersionsPanel actually calls the backend restore endpoint, which
 * evicts connected clients, applies the forward-delta state, and the FE
 * reconnects with the same Y.Doc and refetches the file list.
 *
 * Before the fix the diff dialog's "Apply" did a client-side text replace
 * only — multi-file branches weren't restored and other clients kept their
 * pre-restore state.
 *
 * Strategy: drive the file-set side of restore via the HTTP API (upload +
 * delete a file across two versions) so the assertion is "does the deleted
 * file come back after restore", which exercises the backend reconcile path
 * end-to-end without depending on Y.Doc timing.
 */
test('Restore button on a version row brings back deleted files via the backend', async ({
  page,
  docId,
}) => {
  const request = page.context().request;
  const apiBase = 'http://localhost:5173';

  // 1. Setup: upload an extra file so the snapshot has 2 files (main.tex + extra.tex).
  await uploadFile(request, docId, 'extra.tex', '% extra\n', 'text/plain');
  let files = await getFiles(request, docId);
  expect(files.map((f) => f.filename).sort()).toEqual(['extra.tex', 'main.tex']);

  // 2. Create a version snapshot of the current state ("v1": main + extra).
  const createV1 = await request.post(
    `${apiBase}/api/documents/${docId}/versions`,
    { data: { label: 'with-extra', message: 'has extra.tex' } },
  );
  expect(createV1.ok(), `create v1 failed: ${createV1.status()}`).toBeTruthy();

  // 3. Delete the extra file so the current state diverges from v1.
  const extraFile = files.find((f) => f.filename === 'extra.tex');
  expect(extraFile, 'extra.tex should exist after upload').toBeTruthy();
  const delRes = await request.delete(
    `${apiBase}/api/documents/${docId}/files/${extraFile!.id}`,
  );
  expect(delRes.ok(), `delete extra.tex failed: ${delRes.status()}`).toBeTruthy();

  files = await getFiles(request, docId);
  expect(
    files.filter((f) => !f.filename.startsWith('__restore_')).map((f) => f.filename),
    'after delete, only main.tex should be active',
  ).toEqual(['main.tex']);

  // 4. Open the editor + Info tab where the Versions panel lives.
  await openEditor(page, docId);
  await openInfoTab(page);

  // 5. Click the Restore button on the v1 row, then confirm.
  // The Restore button label is "Restore"; there is exactly one version listed.
  await page.getByRole('button', { name: /^Restore$/ }).click();
  // The confirm dialog has a second Restore button with the History icon.
  // Use the dialog scope to disambiguate from the row button.
  const dialog = page.getByRole('dialog', { name: /restore this version/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Restore$/ }).click();

  // 6. Wait for the success toast that the restore mutation emits. There's
  // also a generic "Document was restored... Reconnecting..." toast that
  // fires from the WS close-code handler; match the specific one to avoid
  // strict-mode ambiguity.
  await expect(
    page.getByText(/Restored "with-extra" — reconnecting/i),
  ).toBeVisible({ timeout: 15_000 });

  // 7. Assert the backend state — the file list now contains extra.tex again.
  // Poll the API because the FE refetch happens on reconnect, which may take
  // a moment; the API call is the authoritative source of truth here.
  await expect
    .poll(
      async () => {
        const refreshed = await getFiles(request, docId);
        return refreshed
          .filter((f) => !f.filename.startsWith('__restore_'))
          .map((f) => f.filename)
          .sort();
      },
      { timeout: 15_000 },
    )
    .toEqual(['extra.tex', 'main.tex']);
});
