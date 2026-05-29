import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Shared E2E fixtures + helpers for the TexMex Playwright suite.
 *
 * Pattern (same shape as tests/conftest.py in the pytest suite):
 *   - Each test registers a unique user via the HTTP API (fast).
 *   - The session cookie is auto-attached because we use `page.context().request`
 *     for HTTP and the same context for browser navigation.
 *   - Tests then exercise the UI for the specific feature under test.
 *
 * Vite proxies /api and /ws to the backend on :3000 — so once the cookie is
 * set on baseURL (localhost:5173), it works for both UI navigation and API calls.
 */

const PASSWORD = 'Pass1234!';
const API_BASE = 'http://localhost:5173'; // proxied to backend by Vite

type RegisteredUser = {
  id: string;
  email: string;
  displayName: string;
};

export async function registerUser(
  request: APIRequestContext,
  label = 'user',
): Promise<RegisteredUser> {
  const unique = Math.random().toString(36).slice(2, 10);
  const email = `${label}-${unique}@e2e.test`;
  const displayName = `${label[0].toUpperCase()}${label.slice(1)}User`;
  const res = await request.post(`${API_BASE}/api/auth/register`, {
    data: { email, displayName, password: PASSWORD },
  });
  expect(
    res.ok(),
    `registerUser failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = await res.json();
  return { id: body.id, email: body.email, displayName: body.displayName };
}

export async function loginUser(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const res = await request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `loginUser failed: ${res.status()}`).toBeTruthy();
}

export async function createDocument(
  request: APIRequestContext,
  title = 'E2E Doc',
  templateId: string | null = null,
): Promise<{ id: string; title: string }> {
  const body: Record<string, unknown> = { title };
  if (templateId) body.templateId = templateId;
  const res = await request.post(`${API_BASE}/api/documents`, { data: body });
  expect(
    res.ok(),
    `createDocument failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const json = await res.json();
  return { id: json.id, title: json.title };
}

export async function getFiles(
  request: APIRequestContext,
  docId: string,
): Promise<Array<{ id: string; filename: string; category: string; isCollaborative: boolean }>> {
  const res = await request.get(`${API_BASE}/api/documents/${docId}/files`);
  expect(res.ok(), `getFiles failed: ${res.status()}`).toBeTruthy();
  return res.json();
}

export async function uploadFile(
  request: APIRequestContext,
  docId: string,
  filename: string,
  content: Buffer | string,
  contentType = 'application/octet-stream',
): Promise<void> {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  const res = await request.post(`${API_BASE}/api/documents/${docId}/files`, {
    multipart: {
      filename,
      file: {
        name: filename.split('/').pop() ?? filename,
        mimeType: contentType,
        buffer,
      },
    },
  });
  expect(
    res.ok(),
    `uploadFile(${filename}) failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
}

/**
 * Opens the editor for `docId`. Waits for the main file (`main.tex`) to load
 * by waiting for the Monaco editor surface to be visible.
 *
 * The app's route convention is `/documents/{entrypoint}#{docId}` — docId lives
 * in the URL hash (see `client/src/utils/editor.ts:getDocId`).
 */
export async function openEditor(
  page: Page,
  docId: string,
  entrypoint = 'main.tex',
): Promise<void> {
  await page.goto(`/documents/${encodeURIComponent(entrypoint)}#${encodeURIComponent(docId)}`);
  // The Monaco editor renders into a div with class "monaco-editor"; wait for it.
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Opens the sidebar's Files tab. The Snippet sidebar uses Radix Tabs.
 */
export async function openFilesTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /files/i }).click();
}

/**
 * Opens the sidebar's Info tab (where Document Versions panel lives).
 */
export async function openInfoTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /info/i }).click();
}

/**
 * Returns the textual content of the Monaco editor's view-lines. Note: Monaco
 * virtualizes lines that are off-screen, so this only reads what's currently
 * rendered. For our tests we type short content that fits in the viewport.
 */
export async function getMainEditorText(page: Page): Promise<string> {
  return page
    .locator('.monaco-editor .view-lines')
    .first()
    .innerText();
}

/**
 * Types text into the Monaco editor as if the user pressed keys. Monaco isn't
 * exposed on `window` so we drive it via the keyboard.
 *
 * `replace` (default true) clears the editor first via Ctrl+A then Delete so
 * subsequent calls don't accumulate.
 */
export async function typeIntoMainEditor(
  page: Page,
  value: string,
  options: { replace?: boolean } = {},
): Promise<void> {
  const { replace = true } = options;
  // Click into the visible editor content area to focus Monaco's hidden
  // textarea. We click `.view-lines` because the textarea itself is rendered
  // beneath the lines and Playwright's normal click is intercepted by them.
  await page.locator('.monaco-editor .view-lines').first().click();
  if (replace) {
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
  }
  await page.keyboard.type(value);
}

/**
 * `test` fixture: each test gets a fresh `user` (registered + logged in) and
 * a `docId` (a blank document owned by that user, with main.tex as entrypoint).
 *
 * Tests that need different setup can use the bare `test` from @playwright/test
 * (re-exported below as `bareTest`).
 */
type Fixtures = {
  user: RegisteredUser;
  docId: string;
};

export const test = base.extend<Fixtures>({
  user: async ({ page }, use) => {
    const user = await registerUser(page.context().request, 'alice');
    await use(user);
  },
  docId: async ({ page, user }, use) => {
    // `user` ensures we're logged in via the same context's cookie jar.
    void user; // referenced for ordering
    const doc = await createDocument(page.context().request, 'E2E Test Doc');
    await use(doc.id);
  },
});

export { expect };
export { test as bareTest } from '@playwright/test';
