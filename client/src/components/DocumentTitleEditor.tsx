import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Save } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SaveAsTemplateDialog } from '@/components/SaveAsTemplateDialog';

type Props = {
  docId: string;
  hasApiDocumentId: boolean;
  /** Authoritative title from the server (resets the input on change). */
  title: string;
  /** Whether this user is allowed to rename the document. */
  canRename: boolean;
  /** Whether this user is allowed to save the doc as a template. */
  canSaveTemplate: boolean;
  /** Called when the user commits a new title (Enter or blur after edit). */
  onRename: (newTitle: string) => Promise<void> | void;
  isRenamePending?: boolean;
  /** Error from a recent rename attempt — shown as a tooltip on the title. */
  renameError?: string | null;
};

const MAX_TITLE = 255;

export const DocumentTitleEditor: React.FC<Props> = ({
  docId,
  hasApiDocumentId,
  title,
  canRename,
  canSaveTemplate,
  onRename,
  isRenamePending,
  renameError,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync the draft when the server-side title changes (or when entering edit mode).
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const enterEdit = () => {
    if (!canRename || !hasApiDocumentId || isRenamePending) return;
    setDraft(title);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next === '' || next === title) {
      // Nothing to do — restore the draft to match the source of truth.
      setDraft(title);
      return;
    }
    void onRename(next);
  };

  const cancel = () => {
    setDraft(title);
    setEditing(false);
  };

  // Fallback display when there's no real document yet (e.g. anonymous session
  // before first save). Keeps the toolbar from looking broken.
  const displayTitle = title.trim() || 'Untitled document';

  return (
    <div className="flex min-w-0 items-center gap-1">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) =>
            setDraft(event.target.value.slice(0, MAX_TITLE))
          }
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
          maxLength={MAX_TITLE}
          className="h-7 min-w-0 max-w-[24rem] flex-1 rounded-sm border border-input bg-background px-2 text-sm font-medium text-foreground focus:border-ring focus:outline-none"
          aria-label="Document title"
        />
      ) : (
        <button
          type="button"
          onClick={enterEdit}
          disabled={!canRename || !hasApiDocumentId}
          className="min-w-0 truncate rounded-sm px-2 py-1 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
          title={
            renameError ??
            (canRename ? 'Click to rename' : displayTitle)
          }
        >
          {displayTitle}
        </button>
      )}

      {(canSaveTemplate || canRename) && hasApiDocumentId && (
        <DocumentActionsMenu
          docId={docId}
          hasApiDocumentId={hasApiDocumentId}
          canRename={canRename}
          canSaveTemplate={canSaveTemplate}
          onRequestRename={enterEdit}
        />
      )}
    </div>
  );
};

type ActionsMenuProps = {
  docId: string;
  hasApiDocumentId: boolean;
  canRename: boolean;
  canSaveTemplate: boolean;
  onRequestRename: () => void;
};

const DocumentActionsMenu: React.FC<ActionsMenuProps> = ({
  docId,
  hasApiDocumentId,
  canRename,
  canSaveTemplate,
  onRequestRename,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);

  // Pop the menu first, then open the dialog on the next tick. Otherwise the
  // popover's dismiss handlers race with the dialog's mount and the dialog
  // flashes open then closed immediately.
  const openDialogAfterMenu = (open: () => void) => () => {
    setMenuOpen(false);
    setTimeout(open, 0);
  };

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Document actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 gap-0 p-1">
          {canRename && (
            <MenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={openDialogAfterMenu(onRequestRename)}
            >
              Rename
            </MenuItem>
          )}
          {canSaveTemplate && (
            <MenuItem
              icon={<Save className="h-3.5 w-3.5" />}
              onClick={openDialogAfterMenu(() => setSaveTemplateOpen(true))}
            >
              Save as template
            </MenuItem>
          )}
        </PopoverContent>
      </Popover>

      {canSaveTemplate && (
        <SaveAsTemplateDialog
          docId={docId}
          hasApiDocumentId={hasApiDocumentId}
          canSaveTemplate={canSaveTemplate}
          open={saveTemplateOpen}
          onOpenChange={setSaveTemplateOpen}
        />
      )}
    </>
  );
};

const MenuItem = React.forwardRef<
  HTMLButtonElement,
  {
    icon?: React.ReactNode;
    onClick?: (event: React.MouseEvent) => void;
    children: React.ReactNode;
  } & React.HTMLAttributes<HTMLButtonElement>
>(({ icon, onClick, children, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
    {...rest}
  >
    {icon}
    <span className="flex-1">{children}</span>
  </button>
));
MenuItem.displayName = 'DocumentActionsMenuItem';
