import { AvatarGroup } from '@/components/ui/avatar-group';
import React from 'react';

type AvatarUser = {
  id: string;
  name: string;
  color: string;
};

type EditorDocumentHeaderProps = {
  autosaveStatus: string;
  hasApiDocumentId: boolean;
  role: 'owner' | 'editor' | 'viewer';
  avatarUsers: AvatarUser[];
  documentQueryError: boolean;
};

// Lean header: only the role badge, the autosave status, and the live
// collaborator avatars live here. Document title rename + per-document
// actions live in the top app toolbar via DocumentTitleEditor.
//
// Container queries (Tailwind 4 @container) drive the priority order at
// narrow pane widths:
//   - avatars: always visible
//   - status:  hidden below the @sm breakpoint
//   - role:    hidden first (below @md)
//
// The whole bar is one row; we never stack — the rename input that used to
// force a 2-row layout is gone, so a single line easily fits the remaining
// items even in very narrow panes.
export const EditorDocumentHeader: React.FC<EditorDocumentHeaderProps> = ({
  autosaveStatus,
  hasApiDocumentId,
  role,
  avatarUsers,
  documentQueryError,
}) => {
  return (
    <div className="@container shrink-0 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground">
      <div className="flex items-center gap-2 text-xs">
        <span className="@max-md:hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {role}
        </span>

        {hasApiDocumentId && (
          <span
            className="@max-sm:hidden min-w-0 truncate whitespace-nowrap text-muted-foreground"
            title={autosaveStatus}
          >
            {autosaveStatus}
          </span>
        )}

        <AvatarGroup users={avatarUsers} className="ml-auto shrink-0" />
      </div>

      {documentQueryError && (
        <p className="mt-2 text-xs text-destructive">
          Could not load document details.
        </p>
      )}
    </div>
  );
};
