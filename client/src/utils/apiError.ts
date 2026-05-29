/**
 * Extracts a user-facing message from an unknown API error value.
 *
 * Handles every error shape we currently see in this codebase:
 *   - Plain `Error` instances → returns `.message`
 *   - Strings → returned as-is
 *   - Openapi-ts wrapped errors (`{ error, response, request }`) where the
 *     parsed body lives under `.body` → tries `body.message` first (the new
 *     unified server shape: `{ status: "error", message: "..." }`), then
 *     `body.error` (the legacy `{ error: "..." }` shape some endpoints
 *     historically used)
 *   - Plain objects → tries `.message`, then `.error`, then `.title`
 *   - Anything else → null (caller provides a fallback)
 *
 * Centralised here so a future server-side error-shape change is a one-file
 * edit. See `project_notes/FE_ERROR_FORMAT_CHANGE.md` for the wire contract.
 */
export function getApiErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      error?: unknown;
      title?: unknown;
      body?: { message?: unknown; error?: unknown };
    };
    if (typeof candidate.body?.message === 'string') return candidate.body.message;
    if (typeof candidate.body?.error === 'string') return candidate.body.error;
    if (typeof candidate.message === 'string') return candidate.message;
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.title === 'string') return candidate.title;
  }
  return null;
}
