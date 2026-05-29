import { test, expect, openEditor, openFilesTab } from './fixtures';

/**
 * Gap 4 verification (FE_INTEGRATION_REVIEW.md): the file picker inputs in
 * FilesTab carry the `accept` attribute derived from ACCEPTED_FILE_EXTENSIONS.
 *
 * Before the fix the inputs had no accept attribute, so the OS picker let
 * users select disallowed files and the server returned a 415 surprise.
 */
test('upload + replace inputs declare an accept allowlist', async ({ page, docId }) => {
  await openEditor(page, docId);
  await openFilesTab(page);

  // Both inputs are hidden by design (they're triggered programmatically
  // via the visible Upload button + per-row Replace button). Use locators
  // that target the file inputs directly.
  const fileInputs = page.locator('input[type="file"]');
  // Two inputs expected: one for new upload, one for replace.
  await expect(fileInputs).toHaveCount(2);

  for (let i = 0; i < 2; i += 1) {
    const accept = await fileInputs.nth(i).getAttribute('accept');
    expect(
      accept,
      `Input #${i} should declare an accept attribute (gap 4 fix)`,
    ).not.toBeNull();
    // Sanity-check a few representative extensions from each category.
    expect(accept).toContain('.tex'); // collaborative
    expect(accept).toContain('.png'); // image
    expect(accept).toContain('.pdf'); // pdf
    expect(accept).toContain('.ttf'); // font
  }
});
