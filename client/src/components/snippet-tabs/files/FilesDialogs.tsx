import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FolderPlus, Loader2 } from 'lucide-react';
import React from 'react';
import type { ConfirmDialogState, PathDialogState } from './types';
import type { FolderOption } from './folderOptions';

// Style helper for the native <select> elements so they match the rest of the
// shadcn surface (no first-party shadcn Select in this repo).
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

// FolderOption + buildFolderOptions moved to ./folderOptions so this file
// only-exports components (Vite Fast Refresh requirement).

type PathInputDialogProps = {
  state: PathDialogState;
  value: string;
  busy: boolean;
  onValueChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
};

export const PathInputDialog: React.FC<PathInputDialogProps> = ({
  state,
  value,
  busy,
  onValueChange,
  onSubmit,
  onClose,
}) => (
  <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="sm:max-w-130">
      <DialogHeader>
        <DialogTitle>{state.title}</DialogTitle>
        <DialogDescription>{state.description}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          maxLength={255}
          disabled={busy}
          placeholder="folder/name.ext"
          autoFocus
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {state.submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);

type ConfirmActionDialogProps = {
  state: ConfirmDialogState;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export const ConfirmActionDialog: React.FC<ConfirmActionDialogProps> = ({
  state,
  busy,
  onConfirm,
  onClose,
}) => (
  <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="sm:max-w-120">
      <DialogHeader>
        <DialogTitle>{state.title}</DialogTitle>
        <DialogDescription>{state.description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant={state.destructive ? 'destructive' : 'default'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {state.confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// ── New / Move / New-folder dialogs ─────────────────────────────────────────

type NewFileDialogProps = {
  open: boolean;
  busy: boolean;
  folderOptions: FolderOption[];
  /** Initially-selected folder. Use "" for the root. */
  initialFolder?: string;
  /** Returns null if the (folder, filename) combo is valid, otherwise an
   *  error message to display under the input. */
  validate?: (folder: string, filename: string) => string | null;
  onSubmit: (folder: string, filename: string) => Promise<void>;
  /** Opens the New-folder dialog. The parent should re-open NewFileDialog
   *  with the newly-created folder pre-selected via `initialFolder`. */
  onRequestNewFolder: () => void;
  onClose: () => void;
};

// Dialog for creating a NEW file. Replaces the inline "type folder/file.tex"
// pattern: now you pick a folder from a dropdown (or "(root)") and type just
// the bare filename. "+ Folder" beside the dropdown opens NewFolderDialog so
// you can mint a new folder without leaving this flow.
export const NewFileDialog: React.FC<NewFileDialogProps> = ({
  open,
  busy,
  folderOptions,
  initialFolder = '',
  validate,
  onSubmit,
  onRequestNewFolder,
  onClose,
}) => {
  const [folder, setFolder] = React.useState(initialFolder);
  const [filename, setFilename] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // Reset whenever the dialog opens; honour initialFolder if the parent just
  // promoted a freshly-created ephemeral folder into the dropdown.
  React.useEffect(() => {
    if (open) {
      setFolder(initialFolder);
      setFilename('');
      setError(null);
    }
  }, [open, initialFolder]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = filename.trim();
    if (!trimmed) {
      setError('Filename is required.');
      return;
    }
    if (trimmed.includes('/')) {
      setError('Filename cannot contain "/". Use the folder dropdown instead.');
      return;
    }
    const validationError = validate?.(folder, trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    try {
      await onSubmit(folder, trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create file.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>New file</DialogTitle>
          <DialogDescription>
            Pick a folder and type the filename (with extension). Folders are
            created automatically when a file is placed inside.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Folder
            </label>
            <div className="flex items-center gap-2">
              <select
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                className={SELECT_CLASS}
                disabled={busy}
              >
                {folderOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRequestNewFolder}
                disabled={busy}
              >
                <FolderPlus className="size-3.5" />
                Folder
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Filename
            </label>
            <Input
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              maxLength={255}
              disabled={busy}
              placeholder="chapter.tex"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Create file
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

type NewFolderDialogProps = {
  open: boolean;
  busy: boolean;
  /** Existing folder names (for duplicate detection). */
  existingFolders: Set<string>;
  /** Optional parent folder. The new folder is created as `<parent>/<name>`
   *  when set, or at the root when empty. */
  parentFolder?: string;
  onSubmit: (folderPath: string) => Promise<void>;
  onClose: () => void;
};

// Dialog for creating an ephemeral folder. The folder lives in the FE state
// only until a file is placed inside; once any file has it as a path prefix
// it becomes "real" automatically. Lost on hard reload if still empty.
export const NewFolderDialog: React.FC<NewFolderDialogProps> = ({
  open,
  busy,
  existingFolders,
  parentFolder = '',
  onSubmit,
  onClose,
}) => {
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Folder name is required.');
      return;
    }
    if (trimmed.includes('/')) {
      setError('Folder name cannot contain "/". Create one folder at a time.');
      return;
    }
    const fullPath = parentFolder ? `${parentFolder}/${trimmed}` : trimmed;
    if (existingFolders.has(fullPath)) {
      setError(`A folder named "${fullPath}" already exists.`);
      return;
    }
    setError(null);
    try {
      await onSubmit(fullPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create folder.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Folders are virtual — they live as path prefixes on files. An empty
            folder won't survive a hard reload until you put a file in it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Folder name {parentFolder && <span>(inside {parentFolder}/)</span>}
            </label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
              disabled={busy}
              placeholder="figures"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Create folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

type MoveFileDialogProps = {
  open: boolean;
  busy: boolean;
  /** The file being moved (full path, for display). */
  filename: string;
  /** Current folder of the file (empty string for root). */
  currentFolder: string;
  folderOptions: FolderOption[];
  onSubmit: (destinationFolder: string) => Promise<void>;
  onRequestNewFolder: () => void;
  onClose: () => void;
};

// Dialog for moving a file to a different folder. Backend reuses the existing
// PATCH /files/{id} rename — a move is just a path change with the bare
// filename preserved.
export const MoveFileDialog: React.FC<MoveFileDialogProps> = ({
  open,
  busy,
  filename,
  currentFolder,
  folderOptions,
  onSubmit,
  onRequestNewFolder,
  onClose,
}) => {
  const [folder, setFolder] = React.useState(currentFolder);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setFolder(currentFolder);
      setError(null);
    }
  }, [open, currentFolder]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (folder === currentFolder) {
      setError('Pick a different folder to move the file.');
      return;
    }
    setError(null);
    try {
      await onSubmit(folder);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move file.');
    }
  };

  // Strip the directory off the displayed filename for the heading; the user
  // already knows the current path from the file tree.
  const lastSlash = filename.lastIndexOf('/');
  const bareName = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>Move file</DialogTitle>
          <DialogDescription>
            Move <span className="font-medium text-foreground">{bareName}</span>{' '}
            to a different folder. The filename stays the same; only the path
            changes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Destination folder
            </label>
            <div className="flex items-center gap-2">
              <select
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                className={SELECT_CLASS}
                disabled={busy}
              >
                {folderOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRequestNewFolder}
                disabled={busy}
              >
                <FolderPlus className="size-3.5" />
                Folder
              </Button>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
