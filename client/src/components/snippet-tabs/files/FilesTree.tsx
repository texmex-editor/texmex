import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File as FileIcon,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderInput,
  Loader2,
  MoreHorizontal,
  Pencil,
  Replace,
  Star,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { isTextEditableFile, type FileTreeNode } from './fileTree';
import { SNIPPET_DRAG_MIME } from '@/utils/editor';
import type { EditingUser } from './types';
import { formatBytes, isImageNode, isLatexTextNode } from './utils';

const TREE_INDENT = 14;

const buildImagePreviewUrl = (docId: string, fileId: string) =>
  `/api/documents/${encodeURIComponent(docId)}/files/${encodeURIComponent(fileId)}`;

type ImageFileHoverCardProps = {
  docId: string;
  node: FileTreeNode;
  children: React.ReactElement;
};

const ImageFileHoverCard: React.FC<ImageFileHoverCardProps> = ({
  docId,
  node,
  children,
}) => {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [hasError, setHasError] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    setPreviewUrl(null);
    setHasError(false);
    setIsLoading(false);
  }, [docId, node.fileId]);

  const previewUrlValue = node.fileId
    ? buildImagePreviewUrl(docId, node.fileId)
    : null;

  return (
    <HoverCard
      openDelay={150}
      closeDelay={75}
      onOpenChange={(open) => {
        if (open && previewUrlValue && !previewUrl && !isLoading && !hasError) {
          setPreviewUrl(previewUrlValue);
        }
      }}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" className="w-80 p-3">
        <div className="space-y-2">
          <div className="truncate text-xs font-medium text-foreground" title={node.fullPath}>
            {node.fullPath}
          </div>
          <div className="overflow-hidden rounded-md">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : previewUrl && !hasError ? (
              <img
                src={previewUrl}
                alt={node.fullPath}
                className="max-h-64 w-full object-contain"
                onLoad={() => setIsLoading(false)}
                onError={() => {
                  setHasError(true);
                  setIsLoading(false);
                }}
              />
            ) : (
              <div className="flex h-40 items-center justify-center px-3 text-center text-xs text-muted-foreground">
                Image preview unavailable
              </div>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

type FilesTreeProps = {
  tree: FileTreeNode[];
  isLoading: boolean;
  isError: boolean;
  canEdit: boolean;
  isBusy: boolean;
  docId: string;
  expandedFolders: Set<string>;
  activeFilePath: string | null;
  /** Used as a filter so the entrypoint file isn't rendered in the tree
   *  (the FilesTab header now owns its display). */
  mainEntrypoint: string;
  editingUsersByPath: Record<string, EditingUser[]>;
  onToggleFolder: (fullPath: string) => void;
  onOpenFileNode: (node: FileTreeNode) => void;
  onRenameFile: (node: FileTreeNode) => void;
  onReplaceFile?: (node: FileTreeNode) => void;
  onDeleteFile: (node: FileTreeNode) => void;
  /** Copies the file with a "<name> copy.<ext>" suffix; see backend
   *  POST /api/documents/{id}/files/{fileId}/duplicate. */
  onDuplicateFile?: (node: FileTreeNode) => void;
  /** Saves the file to the user's Downloads. For collab files this fetches
   *  the live Y.Text content (reflects unsaved edits); for static files it
   *  returns the stored bytes. Backend: GET /api/documents/{id}/files/{fileId}. */
  onDownloadFile?: (node: FileTreeNode) => void;
  /** Opens the move-to-folder dialog (folder picker). When omitted the
   *  menu item is hidden. */
  onMoveFile?: (node: FileTreeNode) => void;
  /** Move-via-drag-and-drop. Receives the dragged file's fileId, its current
   *  full path, and the destination folder ("" for root). Implementation
   *  reuses the PATCH /files/{id} rename endpoint under the hood. */
  onDropFileOnFolder?: (fileId: string, sourcePath: string, destinationFolder: string) => void;
  /** Move a whole folder (with all nested files and sub-folders) via D&D.
   *  Receives the source folder path and the destination folder ("" for root).
   *  The new path is computed as `<destination>/<source-leaf>`. Self-drops and
   *  descendant-drops are filtered out by the tree before this is called. */
  onDropFolderOnFolder?: (sourcePath: string, destinationFolder: string) => void;
  onRenameFolder: (node: FileTreeNode) => void;
  onDeleteFolder: (node: FileTreeNode) => void;
  /** Promote this file to the document's entrypoint. Backend validates the
   *  filename matches an active collab file (returns 400 otherwise → toast).
   *  Undefined for non-owners; in that case the row's star button is hidden. */
  onSetEntrypoint?: (filename: string) => void;
};

export const FilesTree: React.FC<FilesTreeProps> = ({
  tree,
  isLoading,
  isError,
  canEdit,
  isBusy,
  docId,
  expandedFolders,
  activeFilePath,
  mainEntrypoint,
  editingUsersByPath,
  onToggleFolder,
  onOpenFileNode,
  onRenameFile,
  onReplaceFile,
  onDeleteFile,
  onDuplicateFile,
  onDownloadFile,
  onMoveFile,
  onDropFileOnFolder,
  onDropFolderOnFolder,
  onRenameFolder,
  onDeleteFolder,
  onSetEntrypoint,
}) => {
  // Drop-target highlight state. Value is the folder path being hovered over
  // during a drag ("" for root, "src" for a top-level folder, etc.). Null
  // when no drag is currently over a folder target.
  const [dropOverFolder, setDropOverFolder] = React.useState<string | null>(null);

  // During a folder drag we can't read the dataTransfer payload in dragover
  // (browser security), so we cache the source path here at dragstart. Used
  // by isValidMoveTarget to reject drops on the folder itself or any
  // descendant — those would either be no-ops or create paths like A/B/A
  // that the backend rejects anyway.
  const draggedFolderRef = React.useRef<string | null>(null);

  type DragPayload =
    | { kind: 'file'; fileId: string; path: string }
    | { kind: 'folder'; path: string };

  const parseDragPayload = (event: React.DragEvent): DragPayload | null => {
    try {
      const raw = event.dataTransfer.getData(SNIPPET_DRAG_MIME);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (payload?.type === 'file' && typeof payload.fileId === 'string' && typeof payload.path === 'string') {
        return { kind: 'file', fileId: payload.fileId, path: payload.path };
      }
      if (payload?.type === 'folder' && typeof payload.path === 'string') {
        return { kind: 'folder', path: payload.path };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Decides whether a folder row (or the root) should accept the current
  // drag as a move target. Returns false (no drop accepted) when:
  //   - editing is disabled or no callbacks are wired
  //   - the drag isn't ours (no SNIPPET_DRAG_MIME)
  //   - dragging a folder onto itself or one of its descendants (would create
  //     a path like A/B/A or be a literal no-op)
  //   - dragging a folder onto its current parent (no-op — the leaf already
  //     lives there)
  const isValidMoveTarget = (event: React.DragEvent, destinationFolder: string): boolean => {
    if (!canEdit) return false;
    const fileCallback = Boolean(onDropFileOnFolder);
    const folderCallback = Boolean(onDropFolderOnFolder);
    if (!fileCallback && !folderCallback) return false;
    if (!Array.from(event.dataTransfer.types).includes(SNIPPET_DRAG_MIME)) {
      return false;
    }
    // Folder-source guard. draggedFolderRef is populated only during a folder
    // drag; for file drags it stays null and all folder/root targets are valid.
    const source = draggedFolderRef.current;
    if (source) {
      if (!folderCallback) return false;
      // Self drop: dropping a folder onto its own header row.
      if (destinationFolder === source) return false;
      // Descendant: dropping into a child of the dragged folder.
      if (destinationFolder.startsWith(source + '/')) return false;
      // No-op: dropping into the folder that already IS the source's parent.
      const lastSlash = source.lastIndexOf('/');
      const currentParent = lastSlash >= 0 ? source.slice(0, lastSlash) : '';
      if (destinationFolder === currentParent) return false;
    }
    return true;
  };

  const renderEditingUsersBadge = (users: EditingUser[]) => {
    if (users.length === 0) {
      return null;
    }

    const names = users.map((user) => user.name).filter(Boolean);
    const tooltipText =
      names.length > 0
        ? `Editing now: ${names.join(', ')}`
        : 'Editing now';

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-4 shrink-0 items-center justify-center rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
            {users.length}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    );
  };

  const getFileNodeIcon = (node: FileTreeNode) => {
    if (isImageNode(node)) {
      return <FileImage className="size-3.5 shrink-0 text-emerald-500" />;
    }
    if (isLatexTextNode(node)) {
      return <FileCode2 className="size-3.5 shrink-0 text-sky-500" />;
    }
    if (
      isTextEditableFile({
        filename: node.fullPath,
        contentType: node.contentType ?? null,
      })
    ) {
      return <FileText className="size-3.5 shrink-0 text-violet-500" />;
    }
    return <FileIcon className="size-3.5 shrink-0" />;
  };

  const renderNode = (node: FileTreeNode, depth = 0): React.ReactNode => {
    const paddingLeft = 6 + depth * TREE_INDENT;

    if (node.type === 'folder') {
      const isExpanded = expandedFolders.has(node.fullPath);
      const hasChildren = Boolean(node.children && node.children.length > 0);

      const isDropOver = dropOverFolder === node.fullPath;

      return (
        <div key={node.fullPath} className="space-y-1">
          <div
            // Folder rows are themselves draggable so the user can move whole
            // folders into other folders. The drag payload uses the same MIME
            // as file drags but with type:'folder', which the drop handler
            // dispatches on.
            draggable={canEdit && Boolean(onDropFolderOnFolder)}
            onDragStart={(event) => {
              if (!canEdit || !onDropFolderOnFolder) return;
              try {
                const payload = { type: 'folder', path: node.fullPath } as const;
                event.dataTransfer.setData(SNIPPET_DRAG_MIME, JSON.stringify(payload));
                event.dataTransfer.setData('text/plain', node.fullPath + '/');
                event.dataTransfer.effectAllowed = 'move';
                draggedFolderRef.current = node.fullPath;
              } catch {
                // ignore — ref reset in dragend
              }
            }}
            onDragEnd={() => {
              draggedFolderRef.current = null;
              setDropOverFolder(null);
            }}
            className={`group flex items-center gap-1 rounded-md py-1 pr-1 hover:bg-muted/60 ${
              isDropOver ? 'bg-primary/10 ring-1 ring-primary/40' : ''
            }`}
            style={{ paddingLeft }}
            onDragOver={(event) => {
              if (!isValidMoveTarget(event, node.fullPath)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              if (dropOverFolder !== node.fullPath) {
                setDropOverFolder(node.fullPath);
              }
            }}
            onDragLeave={(event) => {
              // Only clear when leaving the row itself (not when moving into
              // a child element). relatedTarget is null when crossing window
              // boundaries; treat that as a leave too.
              const next = event.relatedTarget as Node | null;
              if (!next || !event.currentTarget.contains(next)) {
                if (dropOverFolder === node.fullPath) setDropOverFolder(null);
              }
            }}
            onDrop={(event) => {
              const payload = parseDragPayload(event);
              if (!payload) return;
              event.preventDefault();
              event.stopPropagation();
              setDropOverFolder(null);
              if (payload.kind === 'file') {
                onDropFileOnFolder?.(payload.fileId, payload.path, node.fullPath);
              } else {
                // Re-check guards at drop time (in case the user dropped
                // before dragover fired); isValidMoveTarget already handled
                // them but the drop handler must be defensive.
                if (
                  payload.path === node.fullPath ||
                  node.fullPath.startsWith(payload.path + '/')
                ) {
                  return;
                }
                onDropFolderOnFolder?.(payload.path, node.fullPath);
              }
            }}
          >
            <button
              type="button"
              className="inline-flex items-center justify-center rounded p-0.5 hover:bg-muted"
              onClick={() => onToggleFolder(node.fullPath)}
              disabled={!hasChildren}
              aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
            >
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )
              ) : (
                <span className="inline-block size-3" />
              )}
            </button>
            {isExpanded ? (
              <FolderOpen className="size-4 text-amber-500" />
            ) : (
              <Folder className="size-4 text-amber-500" />
            )}
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-xs"
              onClick={() => onToggleFolder(node.fullPath)}
              title={node.fullPath}
            >
              {node.name}
            </button>
            {canEdit && (
              <div className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={isBusy}
                      aria-label={`Actions for folder ${node.fullPath}`}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => onRenameFolder(node)}>
                      <Pencil className="size-3.5" />
                      Rename folder…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDeleteFolder(node)}
                      variant="destructive"
                    >
                      <Trash2 className="size-3.5" />
                      Delete folder…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {isExpanded &&
            node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const isActive = activeFilePath === node.fullPath;
    const editingUsers = editingUsersByPath[node.fullPath] ?? [];

    const canSetAsMain =
      Boolean(onSetEntrypoint) &&
      isLatexTextNode(node) &&
      node.fullPath !== mainEntrypoint;

    // Grid columns are fixed so the size cell always lands at the same x-coord
    // regardless of filename length: [icon|name (truncate)|editing badge|size|kebab].
    // The editing-badge column is `auto`-sized; when no users are editing it
    // renders nothing and collapses to 0, but the size column still right-aligns
    // because col 4 has a fixed width and col 5 is the trailing kebab.
    const row = (
      <div
        draggable={canEdit}
        onDragStart={(event) => {
          if (!canEdit) return;
          try {
            const payload = {
              type: 'file',
              path: node.fullPath,
              fileId: node.fileId ?? null,
              isImage: isImageNode(node),
              isLatex: isLatexTextNode(node),
              contentType: node.contentType ?? null,
            } as const;
            event.dataTransfer.setData(SNIPPET_DRAG_MIME, JSON.stringify(payload));
            // also set text/plain for a sensible fallback
            event.dataTransfer.setData('text/plain', node.fullPath);
            // 'copyMove' lets each receiver pick: the editor uses 'copy' (snippet
            // insertion), folder rows use 'move' (file move). Drag started while
            // hovering over a folder should still show the move cursor.
            event.dataTransfer.effectAllowed = 'copyMove';
          } catch (e) {
            // ignore
          }
        }}
        className={`group grid grid-cols-[16px_minmax(0,1fr)_auto_3rem_24px] items-center gap-2 rounded-md py-1 pr-1 text-xs hover:bg-muted/60 ${
          isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'
        }`}
        style={{ paddingLeft }}
      >
        {getFileNodeIcon(node)}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="min-w-0 truncate text-left"
              onClick={() => onOpenFileNode(node)}
            >
              {node.name}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {node.fullPath}
          </TooltipContent>
        </Tooltip>
        {renderEditingUsersBadge(editingUsers) ?? <span />}
        <span className="text-right text-[10px] tabular-nums text-muted-foreground/80">
          {formatBytes(node.size)}
        </span>
        {canEdit ? (
          <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={isBusy}
                  aria-label={`Actions for ${node.fullPath}`}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => onOpenFileNode(node)}>
                  <FileText className="size-3.5" />
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRenameFile(node)}>
                  <Pencil className="size-3.5" />
                  Rename…
                </DropdownMenuItem>
                {onMoveFile && (
                  <DropdownMenuItem onClick={() => onMoveFile(node)}>
                    <FolderInput className="size-3.5" />
                    Move…
                  </DropdownMenuItem>
                )}
                {onDuplicateFile && (
                  <DropdownMenuItem onClick={() => onDuplicateFile(node)}>
                    <Copy className="size-3.5" />
                    Duplicate
                  </DropdownMenuItem>
                )}
                {onDownloadFile && (
                  <DropdownMenuItem onClick={() => onDownloadFile(node)}>
                    <Download className="size-3.5" />
                    Download
                  </DropdownMenuItem>
                )}
                {canSetAsMain && (
                  <DropdownMenuItem onClick={() => onSetEntrypoint?.(node.fullPath)}>
                    <Star className="size-3.5" />
                    Set as main file
                  </DropdownMenuItem>
                )}
                {onReplaceFile && (
                  <DropdownMenuItem onClick={() => onReplaceFile(node)}>
                    <Replace className="size-3.5" />
                    Replace…
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDeleteFile(node)} variant="destructive">
                  <Trash2 className="size-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <span />
        )}
      </div>
    );

    return isImageNode(node) ? (
      <ImageFileHoverCard key={node.fullPath} docId={docId} node={node}>
        {row}
      </ImageFileHoverCard>
    ) : (
      row
    );
  };

  // Main file row used to live here; it's now rendered in the FilesTab header
  // (project title + entrypoint pill), so the tree shows ONLY non-entrypoint
  // files. The renderNode() file branch already filters out the entrypoint via
  // `node.fullPath !== mainEntrypoint`, so nothing else changes.

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading files...
      </div>
    );
  }

  if (isError) {
    return <div className="p-3 text-xs text-destructive">Could not load files.</div>;
  }

  // "Empty" means the tree has no nodes OTHER than the entrypoint (which we
  // don't render here anymore). Show a small empty hint that doesn't duplicate
  // the entrypoint info already visible in the header.
  if (tree.length === 0 || tree.every((n) => n.type === 'file' && n.fullPath === mainEntrypoint)) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No additional files yet. Upload one or create a new file.
      </div>
    );
  }

  // Root drop target: drops on the tree wrapper that aren't caught by a
  // folder row land here, meaning "move to document root". Sentinel for the
  // dropOverFolder state is the empty string "".
  const isRootDropOver = dropOverFolder === '';
  return (
    <div
      className={`space-y-1 rounded-md transition-colors ${
        isRootDropOver ? 'bg-primary/5 ring-1 ring-primary/30' : ''
      }`}
      onDragOver={(event) => {
        if (!isValidMoveTarget(event, '')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropOverFolder !== '') setDropOverFolder('');
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          if (dropOverFolder === '') setDropOverFolder(null);
        }
      }}
      onDrop={(event) => {
        const payload = parseDragPayload(event);
        if (!payload) return;
        event.preventDefault();
        setDropOverFolder(null);
        if (payload.kind === 'file') {
          onDropFileOnFolder?.(payload.fileId, payload.path, '');
        } else {
          // Folder onto root = move folder to the document root. Skip if it's
          // already at root (current parent === root → isValidMoveTarget
          // already filters this, but be defensive).
          const lastSlash = payload.path.lastIndexOf('/');
          const currentParent = lastSlash >= 0 ? payload.path.slice(0, lastSlash) : '';
          if (currentParent === '') return;
          onDropFolderOnFolder?.(payload.path, '');
        }
      }}
    >
      {tree.map((node) => renderNode(node, 0))}
    </div>
  );
};
