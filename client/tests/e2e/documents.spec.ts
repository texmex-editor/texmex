import {
  test,
  expect,
  uploadFile,
  openEditor,
  openFilesTab,
} from './fixtures';

const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0),
]);

/**
 * Tier 2 — multi-file editing: an image and a .bib file appear in the file
 * tree under the right categories. Verifies the multi-file UI the FE team
 * built (independent of our PR 14 fixes).
 */
test('uploaded image + .bib show in file tree with correct icons', async ({
  page,
  docId,
}) => {
  const request = page.context().request;
  await uploadFile(request, docId, 'fig/logo.png', PNG_HEADER, 'image/png');
  await uploadFile(
    request,
    docId,
    'refs.bib',
    '@article{foo, title={Bar}}\n',
    'application/x-bibtex',
  );

  await openEditor(page, docId);
  await openFilesTab(page);

  // Scope assertions to the sidebar's Files tab panel — the editor-tabs bar
  // also has a "main.tex" button so an unscoped getByRole would be ambiguous.
  const filesPanel = page.getByRole('tabpanel', { name: /files/i });
  await expect(filesPanel).toBeVisible();
  // exact:true is required because the action buttons on each file row use
  // aria-labels like "Rename file refs.bib" which would otherwise match.
  await expect(
    filesPanel.getByRole('button', { name: 'main.tex', exact: true }),
  ).toBeVisible();
  // File list refetches on a 12s interval, so first paint may not include
  // the API-uploaded files; allow extra time.
  await expect(
    filesPanel.getByRole('button', { name: 'refs.bib', exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  // Expand the fig folder to reveal logo.png.
  await filesPanel.getByRole('button', { name: 'fig', exact: true }).click();
  await expect(
    filesPanel.getByRole('button', { name: 'logo.png', exact: true }),
  ).toBeVisible();
});
