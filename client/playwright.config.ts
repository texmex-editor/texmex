import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for TexMex end-to-end tests.
 *
 * Prereqs:
 * - Backend server running on http://localhost:3000 (e.g. `cd server && dotnet run`).
 * - Postgres + the LaTeX compiler container (`docker compose -f ../docker-compose.infra.yml up -d`).
 * - Tests start the Vite dev server themselves via the `webServer` block below.
 *
 * Run:
 *   npm run test:e2e               # headless, all tests
 *   npm run test:e2e:headed        # headed (uses WSLg DISPLAY=:0 on this box)
 *   npx playwright test version    # only files matching "version"
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // backend autosave + WS state is per-document; serial is simpler
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // single worker for now — tests share the backend
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The default 1280x720 collapses the snippet sidebar enough that
        // file-row buttons (which use min-w-0 + flex-1) shrink to 0 width
        // and Playwright reports them as hidden. Widen the viewport.
        viewport: { width: 1600, height: 900 },
      },
    },
  ],

  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
