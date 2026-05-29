import { test, expect, openEditor } from './fixtures';

const PASSWORD = 'Pass1234!';

/**
 * Section 6 verification: the Account Settings dialog wires the three new
 * /api/auth/me, /change-password, /change-email endpoints end-to-end.
 *
 * The dialog lives in the Toolbar (gear icon next to Logout) on the editor
 * page. We use the `docId` fixture to get there with the seeded doc; the
 * tests don't touch the document itself.
 */

test('change display name updates the toolbar avatar', async ({
  page,
  user,
  docId,
}) => {
  await openEditor(page, docId);
  // The current display name should be visible in the toolbar.
  await expect(page.getByText(user.displayName, { exact: true })).toBeVisible();

  // Open Account Settings.
  await page.getByRole('button', { name: /account settings/i }).click();
  const dialog = page.getByRole('dialog', { name: /account settings/i });
  await expect(dialog).toBeVisible();

  const newDisplayName = `${user.displayName}.renamed`;
  const nameInput = dialog.getByLabel(/display name/i);
  await nameInput.fill(newDisplayName);
  // The Save button in the display-name section.
  await dialog
    .locator('form', { hasText: /display name/i })
    .getByRole('button', { name: /^save$/i })
    .click();

  await expect(page.getByText('Display name updated')).toBeVisible({
    timeout: 10_000,
  });

  // Close the dialog to return focus to the toolbar.
  await page.keyboard.press('Escape');

  // The toolbar avatar label should reflect the new name (App.setUser fired).
  await expect(page.getByText(newDisplayName, { exact: true })).toBeVisible({
    timeout: 5_000,
  });
});

test('change password succeeds with current password + re-login works', async ({
  page,
  user,
  docId,
}) => {
  await openEditor(page, docId);
  await page.getByRole('button', { name: /account settings/i }).click();
  const dialog = page.getByRole('dialog', { name: /account settings/i });
  await expect(dialog).toBeVisible();

  const newPassword = 'NewPass5678!';

  const pwForm = dialog.locator('form', { hasText: /change password/i });
  await pwForm.getByLabel(/current password/i).fill(PASSWORD);
  await pwForm.getByLabel(/new password/i).fill(newPassword);
  await pwForm.getByRole('button', { name: /change password/i }).click();

  await expect(
    page.getByText(/Password changed.*signed out/i),
  ).toBeVisible({ timeout: 10_000 });

  // Close the dialog, log out, navigate to landing, and log back in with
  // the new password. Logout from the editor doesn't auto-route back; we
  // navigate explicitly so the landing page's Log In button is visible.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^logout$/i }).click();
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /^log ?in$/i }).first(),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /^log ?in$/i }).first().click();
  const loginDialog = page.getByRole('dialog', { name: /log ?in/i });
  await loginDialog.getByLabel(/email/i).fill(user.email);
  await loginDialog.getByLabel(/^password$/i).fill(newPassword);
  await loginDialog.getByRole('button', { name: /^log ?in$/i }).click();

  await expect(
    page.getByText(user.displayName, { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
});

test('change email succeeds with current password', async ({
  page,
  user,
  docId,
}) => {
  await openEditor(page, docId);
  await page.getByRole('button', { name: /account settings/i }).click();
  const dialog = page.getByRole('dialog', { name: /account settings/i });
  await expect(dialog).toBeVisible();

  const newEmail = `renamed-${Math.random().toString(36).slice(2, 8)}@e2e.test`;

  const emailForm = dialog.locator('form', { hasText: /change email/i });
  await emailForm.getByLabel(/new email/i).fill(newEmail);
  await emailForm.getByLabel(/current password/i).fill(PASSWORD);
  await emailForm.getByRole('button', { name: /change email/i }).click();

  await expect(
    page.getByText(/Email changed.*signed out/i),
  ).toBeVisible({ timeout: 10_000 });

  // Verify the server side by hitting /api/auth/me — the email should be new.
  const meResponse = await page.context().request.get(
    'http://localhost:5173/api/auth/me',
  );
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json();
  expect(me.email).toBe(newEmail);
  // user.id stays the same — only the email field changed.
  expect(me.id).toBe(user.id);
});
