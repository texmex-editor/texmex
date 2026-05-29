import { test, expect, openEditor, typeIntoMainEditor } from './fixtures';

/**
 * Tier 2 — compile path: typing a minimal LaTeX document into main.tex
 * autosaves and the compile pipeline produces a PDF preview. The auto-compile
 * setting is on by default in this app.
 */
test('typing LaTeX content produces a rendered PDF preview', async ({
  page,
  docId,
}) => {
  await openEditor(page, docId);

  // Type a minimal compilable document.
  const minimalLatex =
    '\\documentclass{article}\n\\begin{document}\nHello E2E!\n\\end{document}\n';
  await typeIntoMainEditor(page, minimalLatex);

  // Wait for autosave to flush.
  await expect(page.getByText(/^Saved at /i)).toBeVisible({ timeout: 20_000 });

  // PDFPreview renders the compiled document into one or more <canvas>
  // elements (pdf.js uses one per page; multiple are normal). Wait for
  // at least one to appear. TeX Live compile can take several seconds.
  await expect
    .poll(async () => page.locator('canvas').count(), { timeout: 45_000 })
    .toBeGreaterThanOrEqual(1);
});
