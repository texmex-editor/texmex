import { test, expect } from '@playwright/test';

const PASSWORD = 'Pass1234!';

/**
 * Tier 2 — full auth happy path through the UI: signup → logout → login.
 *
 * Exercises the Signup dialog (which now reads the unified `{ status, message }`
 * error shape via getApiErrorMessage) end-to-end against the running server.
 */
test('signup → logout → log back in via the UI', async ({ page }) => {
  const unique = Math.random().toString(36).slice(2, 10);
  const email = `e2e-auth-${unique}@e2e.test`;
  // Display-name regex (server-side): ^[a-zA-Z0-9._ ]+$ — no hyphens allowed.
  const displayName = `AuthUser.${unique}`;

  await page.goto('/');

  // Open the Signup dialog.
  await page.getByRole('button', { name: /^sign up$/i }).first().click();
  const signupDialog = page.getByRole('dialog', { name: /^sign up$/i });
  await expect(signupDialog).toBeVisible({ timeout: 10_000 });

  // Fill + submit.
  await signupDialog.getByLabel(/email/i).fill(email);
  await signupDialog.getByLabel(/display name/i).fill(displayName);
  await signupDialog.getByLabel(/^password$/i).fill(PASSWORD);
  await signupDialog.getByRole('button', { name: /^sign up$/i }).click();

  // Authenticated landing shows the user's display name in the toolbar.
  await expect(page.getByText(displayName, { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // Logout returns to the unauthenticated landing.
  await page.getByRole('button', { name: /^logout$/i }).click();
  await expect(page.getByRole('button', { name: /^log ?in$/i }).first()).toBeVisible(
    { timeout: 10_000 },
  );

  // Log back in via the Login dialog.
  await page.getByRole('button', { name: /^log ?in$/i }).first().click();
  const loginDialog = page.getByRole('dialog', { name: /log ?in/i });
  await expect(loginDialog).toBeVisible();
  await loginDialog.getByLabel(/email/i).fill(email);
  await loginDialog.getByLabel(/^password$/i).fill(PASSWORD);
  await loginDialog.getByRole('button', { name: /^log ?in$/i }).click();

  await expect(page.getByText(displayName, { exact: true })).toBeVisible({
    timeout: 10_000,
  });
});
