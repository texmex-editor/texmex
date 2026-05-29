import { test, expect, registerUser, openEditor } from './fixtures';

/**
 * Tier 2 — invite a collaborator by email and verify they appear in the
 * Manage Access panel.
 */
test('owner can invite a user by email and see them in the collaborator list', async ({
  page,
  user, // owner (alice)
  docId,
  playwright,
}) => {
  // 1. Register Bob via an ISOLATED request context so his Set-Cookie
  // doesn't overwrite Alice's session in the page's context. (Mixing the
  // two cookie jars caused a flaky failure where the editor sometimes
  // never reached "Connected" because the page navigation raced with
  // the re-login.)
  const bobContext = await playwright.request.newContext();
  const bob = await registerUser(bobContext, 'bob');
  await bobContext.dispose();

  // 2. Open the editor as Alice (her cookie is untouched).
  await openEditor(page, docId);

  // 3. Open the Manage Access panel from the toolbar.
  await page.getByRole('button', { name: /manage access/i }).click();

  // 4. The dialog is titled "Collaborators & sharing"; the email input
  // uses placeholder "name@example.com" and the submit button is "Add".
  const panel = page.getByRole('dialog', { name: /collaborators/i });
  await expect(panel).toBeVisible({ timeout: 10_000 });

  await panel.getByPlaceholder('name@example.com').fill(bob.email);
  await panel.getByRole('button', { name: /^Add$/ }).click();

  // 5. Bob should appear in the collaborator list inside the panel.
  // The row shows email + display name.
  await expect(panel.getByText(bob.email)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText(bob.displayName)).toBeVisible({ timeout: 5_000 });
});
