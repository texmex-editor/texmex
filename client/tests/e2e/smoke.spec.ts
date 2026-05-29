import { test, expect } from '@playwright/test';

/**
 * Minimal smoke test — verifies Chromium launches in this WSL env and the
 * Vite dev server is reachable. Run first before writing the full suite.
 */
test('chromium launches and dev server responds', async ({ page }) => {
  await page.goto('/');
  // Whatever the landing page looks like, the <body> should exist and load.
  await expect(page.locator('body')).toBeVisible();
  console.log('page title:', await page.title());
});
