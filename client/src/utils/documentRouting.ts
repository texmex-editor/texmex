export const DEFAULT_DOCUMENT_ENTRYPOINT = 'main.tex';

export function toEditorPath(documentId: string, entrypoint?: string | null): string {
  const safeEntrypoint = entrypoint?.trim() ? entrypoint.trim() : DEFAULT_DOCUMENT_ENTRYPOINT;
  return `/documents/${encodeURIComponent(safeEntrypoint)}#${encodeURIComponent(documentId)}`;
}

export function buildInviteJoinUrl(token: string): string {
  return `${window.location.origin}/join/${encodeURIComponent(token)}`;
}

export function buildAnonymousJoinUrl(token: string): string {
  return `${window.location.origin}/join/anonymous/${encodeURIComponent(token)}`;
}

