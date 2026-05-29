import { test, expect, openEditor, typeIntoMainEditor } from './fixtures';

/**
 * Gap 3 verification (FE_INTEGRATION_REVIEW.md): the trash button in the
 * "My templates" tab of NewDocumentDialog calls deleteApiTemplatesById,
 * which previously had zero callers (a typo in a template title was
 * permanent).
 */
test('Delete button removes a user-owned template from My templates', async ({
  page,
  docId,
}) => {
  const request = page.context().request;
  const apiBase = 'http://localhost:5173';

  // 1. Setup: open the editor, type some content into main.tex, wait for
  // the autosave indicator so the Y.Doc is flushed to the DB, then save
  // as template via the API. (Save-as-template returns 422 if main.tex
  // is empty.)
  await openEditor(page, docId);
  await typeIntoMainEditor(page, 'E2E template content');
  // Autosave indicator transitions: "Unsaved changes" -> "Saving..." -> "Saved at HH:MM:SS"
  await expect(page.getByText(/^Saved at /i)).toBeVisible({
    timeout: 20_000,
  });

  const unique = Math.random().toString(36).slice(2, 8);
  const templateTitle = `E2E Template ${unique}`;
  const saveAs = await request.post(
    `${apiBase}/api/documents/${docId}/save-as-template`,
    {
      data: {
        title: templateTitle,
        category: 'other',
        description: 'created by playwright',
        isPublic: false,
        fileIds: [],
      },
    },
  );
  expect(
    saveAs.ok(),
    `save-as-template failed: ${saveAs.status()} ${await saveAs.text()}`,
  ).toBeTruthy();

  // 2. Navigate to the landing page and open the New Document dialog.
  await page.goto('/');
  await page.getByRole('button', { name: /new document/i }).first().click();

  // 3. Switch to My templates tab.
  const dialog = page.getByRole('dialog', { name: /create document/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: /my templates/i }).click();

  // 4. The row is in the dialog; the trash button is hidden until hover/focus.
  // Find the row by template title, hover it, then click the delete button.
  const templateRow = dialog.locator('div', { hasText: templateTitle }).first();
  await expect(templateRow).toBeVisible({ timeout: 10_000 });
  await templateRow.hover();

  const deleteButton = dialog.getByRole('button', {
    name: new RegExp(`Delete template "${templateTitle}"`, 'i'),
  });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();

  // 5. Confirm in the delete dialog.
  const confirmDialog = page.getByRole('dialog', { name: /delete template/i });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: /^Delete$/ }).click();

  // 6. Toast confirms; the row should be gone from the dialog.
  await expect(page.getByText(`Deleted "${templateTitle}"`)).toBeVisible({
    timeout: 10_000,
  });
  await expect(dialog.getByText(templateTitle)).not.toBeVisible({
    timeout: 10_000,
  });

  // 7. Backend confirms the delete.
  const listAfter = await request.get(`${apiBase}/api/templates`);
  const items = await listAfter.json();
  const stillThere = items.find((t: any) => t.title === templateTitle);
  expect(stillThere, 'template should be gone from the server too').toBeUndefined();
});
