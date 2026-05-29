import {
  deleteApiDocumentsByIdFilesByFileIdMutation,
  getApiDocumentsByIdFilesOptions,
  getApiDocumentsByIdFilesQueryKey,
  getApiDocumentsByIdQueryKey,
  patchApiDocumentsByIdFilesByFileIdMutation,
  postApiDocumentsByIdFilesByFileIdDuplicateMutation,
  postApiDocumentsByIdFilesByOldFileIdReplaceMutation,
  postApiDocumentsByIdFilesMutation,
  postApiDocumentsByIdFoldersDeleteMutation,
  postApiDocumentsByIdFoldersRenameMutation,
} from '@/client/@tanstack/react-query.gen';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Download,
  FileCode2,
  FolderInput,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Upload,
} from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';
import { ACCEPTED_FILE_EXTENSIONS } from '@/utils/fileCategories';
import {
  ConfirmActionDialog,
  MoveFileDialog,
  NewFileDialog,
  NewFolderDialog,
  PathInputDialog,
} from './FilesDialogs';
import { buildFolderOptions } from './folderOptions';
import { FilesTree } from './FilesTree';
import {
  buildFileTree,
  collectFilesByPrefix,
  flattenFiles,
  isTextEditableFile,
  mergeEphemeralFolders,
  validateFilename,
  type FileTreeNode,
} from './fileTree';
import type {
  ConfirmDialogState,
  FilesTabProps,
  PathDialogState,
} from './types';
import { getApiErrorMessage } from './utils';

export const FilesTab: React.FC<FilesTabProps> = ({
  docId,
  hasApiDocumentId,
  canEdit,
  documentTitle,
  entrypoint,
  mainEntrypointByteSize,
  onOpenMainFile,
  onOpenFile,
  onSetEntrypoint,
  activeFilePath,
  editingUsersByPath = {},
}) => {
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  // Separate ref + target for the replace flow so it doesn't fight the upload input.
  const replaceInputRef = React.useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = React.useRef<{ fileId: string; filename: string } | null>(
    null,
  );
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(
    () => new Set(),
  );
  // Ephemeral folder state: folders the user created via NewFolderDialog but
  // hasn't yet put a file in. Lives only in FE state (lost on hard reload);
  // once a file lands in the folder its prefix exists in the file list and
  // the merger dedupes. Per the design discussion: zero schema cost, fine
  // brief inconsistency window between collaborators.
  const [ephemeralFolders, setEphemeralFolders] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [newFileDialogOpen, setNewFileDialogOpen] = React.useState(false);
  const [newFileInitialFolder, setNewFileInitialFolder] = React.useState('');
  const [newFolderDialogOpen, setNewFolderDialogOpen] = React.useState(false);
  // Set when the New-folder dialog was opened from inside the New-file or
  // Move-file dialog — once the folder is created we re-open that dialog with
  // the new folder pre-selected so the user can complete their original flow.
  const [
    newFolderReturnTo,
    setNewFolderReturnTo,
  ] = React.useState<'newFile' | 'moveFile' | null>(null);
  const [moveDialogTarget, setMoveDialogTarget] =
    React.useState<FileTreeNode | null>(null);
  const [dialogBusy, setDialogBusy] = React.useState(false);
  const [pathInput, setPathInput] = React.useState('');
  const [pathDialog, setPathDialog] = React.useState<PathDialogState>({
    open: false,
    title: '',
    description: '',
    submitLabel: 'Save',
  });
  const [confirmDialog, setConfirmDialog] = React.useState<ConfirmDialogState>({
    open: false,
    title: '',
    description: '',
    confirmLabel: 'Confirm',
    destructive: false,
  });
  const pathActionRef = React.useRef<((value: string) => Promise<void>) | null>(
    null,
  );
  const confirmActionRef = React.useRef<(() => Promise<void>) | null>(null);

  const filesQuery = useQuery({
    ...getApiDocumentsByIdFilesOptions({
      path: { id: docId },
    }),
    enabled: hasApiDocumentId,
    refetchInterval: hasApiDocumentId ? 12000 : false,
  });

  const invalidateFileList = React.useCallback(async () => {
    // Invalidate BOTH the file list AND the document detail. Document detail
    // carries Document.Entrypoint, which the backend updates atomically when
    // the entrypoint file is renamed / moved (see RenameFileAsync). Without
    // refetching the document, the header pill keeps showing the OLD entrypoint
    // name and the tree filter still excludes the old name — so the renamed
    // file shows up as a regular file row in the tree (and the header is
    // stale). Refetching both keeps them in sync.
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getApiDocumentsByIdFilesQueryKey({ path: { id: docId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: getApiDocumentsByIdQueryKey({ path: { id: docId } }),
      }),
    ]);
  }, [docId, queryClient]);

  const uploadMutation = useMutation({
    ...postApiDocumentsByIdFilesMutation(),
    onSuccess: async () => {
      await invalidateFileList();
    },
  });

  const renameMutation = useMutation({
    ...patchApiDocumentsByIdFilesByFileIdMutation(),
    onSuccess: async () => {
      await invalidateFileList();
    },
  });

  const deleteMutation = useMutation({
    ...deleteApiDocumentsByIdFilesByFileIdMutation(),
    onSuccess: async () => {
      await invalidateFileList();
    },
  });

  const replaceMutation = useMutation({
    ...postApiDocumentsByIdFilesByOldFileIdReplaceMutation(),
    onSuccess: async () => {
      await invalidateFileList();
    },
  });

  const duplicateMutation = useMutation({
    ...postApiDocumentsByIdFilesByFileIdDuplicateMutation(),
    onSuccess: async () => {
      await invalidateFileList();
    },
  });

  // Atomic folder operations — replace the prior per-file PATCH loop that
  // could leave the document half-renamed on a mid-loop conflict. See
  // server/Api/Documents/FolderEndpoints.cs for the pre-validate-or-rollback
  // semantics.
  const folderRenameMutation = useMutation({
    ...postApiDocumentsByIdFoldersRenameMutation(),
    onSuccess: async () => {
      await invalidateFileList();
    },
  });

  const folderDeleteMutation = useMutation({
    ...postApiDocumentsByIdFoldersDeleteMutation(),
    onSuccess: async () => {
      await invalidateFileList();
    },
  });

  const mainEntrypoint = (entrypoint ?? 'main.tex').trim() || 'main.tex';
  const mainEntrypointLower = mainEntrypoint.toLowerCase();
  const files = React.useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const mainFile = React.useMemo(
    () =>
      files.find(
        (file) =>
          (file.filename ?? '').trim().toLowerCase() === mainEntrypointLower,
      ),
    [files, mainEntrypointLower],
  );
  const nonEntrypointFiles = React.useMemo(
    () =>
      files.filter(
        (file) =>
          (file.filename ?? '').trim().toLowerCase() !== mainEntrypointLower,
      ),
    [files, mainEntrypointLower],
  );
  const tree = React.useMemo(
    () => mergeEphemeralFolders(buildFileTree(nonEntrypointFiles), ephemeralFolders),
    [nonEntrypointFiles, ephemeralFolders],
  );
  const flattenedFiles = React.useMemo(() => flattenFiles(tree), [tree]);

  // Folder list driving the NewFile / Move dialogs. "Real" folders come from
  // file-path prefixes (every "src/util.tex" implies a "src" folder); the
  // ephemeral set adds folders the user just created but hasn't filed into.
  const realFolderSet = React.useMemo(() => {
    const set = new Set<string>();
    for (const file of files) {
      const path = (file.filename ?? '').trim();
      if (!path) continue;
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join('/'));
      }
    }
    return set;
  }, [files]);

  const allFolderSet = React.useMemo(() => {
    const set = new Set<string>(realFolderSet);
    for (const folder of ephemeralFolders) set.add(folder);
    return set;
  }, [realFolderSet, ephemeralFolders]);

  const folderOptions = React.useMemo(
    () => buildFolderOptions(allFolderSet),
    [allFolderSet],
  );
  const mainFileSize = React.useMemo(() => {
    const apiSize = mainFile?.size;
    if (typeof apiSize === 'number' && apiSize > 0) {
      return apiSize;
    }
    if (typeof mainEntrypointByteSize === 'number') {
      return mainEntrypointByteSize;
    }
    return apiSize;
  }, [mainEntrypointByteSize, mainFile?.size]);

  const isBusy =
    uploadMutation.isPending ||
    renameMutation.isPending ||
    deleteMutation.isPending ||
    replaceMutation.isPending ||
    duplicateMutation.isPending ||
    folderRenameMutation.isPending ||
    folderDeleteMutation.isPending ||
    dialogBusy;

  const getValidationError = React.useCallback(
    (filename: string) => validateFilename(filename, mainEntrypoint),
    [mainEntrypoint],
  );

  const openPathDialog = React.useCallback(
    (
      config: Omit<PathDialogState, 'open'> & {
        initialValue: string;
        onSubmit: (value: string) => Promise<void>;
      },
    ) => {
      pathActionRef.current = config.onSubmit;
      setPathInput(config.initialValue);
      setPathDialog({
        open: true,
        title: config.title,
        description: config.description,
        submitLabel: config.submitLabel,
      });
    },
    [],
  );

  const openConfirmDialog = React.useCallback(
    (
      config: Omit<ConfirmDialogState, 'open'> & {
        onConfirm: () => Promise<void>;
      },
    ) => {
      confirmActionRef.current = config.onConfirm;
      setConfirmDialog({
        open: true,
        title: config.title,
        description: config.description,
        confirmLabel: config.confirmLabel,
        destructive: config.destructive,
      });
    },
    [],
  );

  const closePathDialog = React.useCallback(() => {
    if (dialogBusy) return;
    setPathDialog((previous) => ({ ...previous, open: false }));
    setPathInput('');
    pathActionRef.current = null;
  }, [dialogBusy]);

  const closeConfirmDialog = React.useCallback(() => {
    if (dialogBusy) return;
    setConfirmDialog((previous) => ({ ...previous, open: false }));
    confirmActionRef.current = null;
  }, [dialogBusy]);

  const executeCreateFile = React.useCallback(
    async (filename: string) => {
      const extension = filename.split('.').pop()?.toLowerCase() ?? '';
      const contentType =
        extension === 'tex' || extension === 'bib' || extension === 'sty'
          ? 'text/plain'
          : 'application/octet-stream';
      const initialContent =
        contentType === 'text/plain' ? '% New file\n' : new Uint8Array([0]);
      const file = new File(
        [initialContent],
        filename.split('/').pop() || filename,
        {
          type: contentType,
        },
      );

      await uploadMutation.mutateAsync({
        path: { id: docId },
        body: {
          file,
          filename,
        } as any,
      });

      toast.success(`Created "${filename}"`);
    },
    [docId, uploadMutation],
  );

  // Dialog-driven create: NewFileDialog hands us (folder, filename) — join
  // them, validate, and upload through the same code path as the old form.
  const handleCreateFileFromDialog = React.useCallback(
    async (folder: string, filename: string) => {
      if (!canEdit || !hasApiDocumentId) return;
      const fullPath = folder ? `${folder}/${filename}` : filename;
      const validationError = getValidationError(fullPath);
      if (validationError) {
        throw new Error(validationError);
      }
      const exists = files.some(
        (file) =>
          (file.filename ?? '').toLowerCase() === fullPath.toLowerCase(),
      );
      if (exists) {
        throw new Error(
          `A file named "${fullPath}" already exists. Pick a different name.`,
        );
      }
      await executeCreateFile(fullPath);
      setNewFileDialogOpen(false);
    },
    [canEdit, executeCreateFile, files, getValidationError, hasApiDocumentId],
  );

  // Ephemeral folder creation: just adds to FE state. When the user later
  // creates a file inside, the folder becomes "real" via the file's prefix.
  const handleCreateEphemeralFolder = React.useCallback(
    async (folderPath: string) => {
      setEphemeralFolders((previous) => {
        const next = new Set(previous);
        next.add(folderPath);
        return next;
      });
      // Expand the new folder in the tree so the user immediately sees where
      // it lives. The tree itself won't render the folder until a file lands
      // in it (virtual model), but if they put a file in it next, it'll show
      // up already expanded.
      setExpandedFolders((previous) => {
        const next = new Set(previous);
        next.add(folderPath);
        return next;
      });
      setNewFolderDialogOpen(false);
      // Return-to handling: if this New-folder flow was launched from inside
      // NewFile or Move dialog, re-open that dialog with the new folder
      // pre-selected.
      if (newFolderReturnTo === 'newFile') {
        setNewFileInitialFolder(folderPath);
        setNewFileDialogOpen(true);
      }
      // Move dialog re-open is handled inline via its open state — the target
      // is still in moveDialogTarget; we just need to bump the open flag.
      // (Currently MoveFileDialog re-reads currentFolder on open, so an
      // explicit re-open is enough.)
      setNewFolderReturnTo(null);
      toast.success(`Folder "${folderPath}" added`);
    },
    [newFolderReturnTo],
  );

  // Move = path change; reuse existing PATCH /files/{id} rename endpoint.
  // Extracted as a fileId/path-based helper so both the MoveFileDialog and the
  // drag-and-drop drop handlers can call it without owning a FileTreeNode.
  // Returns true on success so D&D can short-circuit further work.
  const moveFileToFolder = React.useCallback(
    async (fileId: string, sourcePath: string, destinationFolder: string) => {
      const lastSlash = sourcePath.lastIndexOf('/');
      const sourceFolder = lastSlash >= 0 ? sourcePath.slice(0, lastSlash) : '';
      if (sourceFolder === destinationFolder) return false; // no-op
      const bareName = lastSlash >= 0 ? sourcePath.slice(lastSlash + 1) : sourcePath;
      const newFilename = destinationFolder
        ? `${destinationFolder}/${bareName}`
        : bareName;
      const validationError = getValidationError(newFilename);
      if (validationError) {
        throw new Error(validationError);
      }
      await renameMutation.mutateAsync({
        path: { id: docId, fileId },
        body: { newFilename },
      });
      toast.success(`Moved to "${newFilename}"`);
      return true;
    },
    [docId, getValidationError, renameMutation],
  );

  const handleMoveFile = React.useCallback(
    async (node: FileTreeNode, destinationFolder: string) => {
      if (node.type !== 'file' || !node.fileId) return;
      await moveFileToFolder(node.fileId, node.fullPath, destinationFolder);
      setMoveDialogTarget(null);
    },
    [moveFileToFolder],
  );

  // D&D entry point. Called from FilesTree when a file row is dropped on a
  // folder row or the root area. Catches errors with a toast so D&D failure
  // doesn't bubble into the surrounding tree component.
  const handleDropFileOnFolder = React.useCallback(
    (fileId: string, sourcePath: string, destinationFolder: string) => {
      void (async () => {
        try {
          await moveFileToFolder(fileId, sourcePath, destinationFolder);
        } catch (error) {
          toast.error(
            getApiErrorMessage(error) ?? `Could not move the file.`,
          );
        }
      })();
    },
    [moveFileToFolder],
  );

  // Folder D&D entry point. The new path is composed by taking the source
  // folder's leaf name and appending it to the destination prefix (so dragging
  // "src/util" onto "lib" yields "lib/util"). Pre-checks here are belt-and-
  // suspenders — FilesTree already filters self/descendant/no-op drops in
  // isValidMoveTarget, but the backend ALSO enforces them and we want a
  // friendly toast for any edge that slips through.
  //
  // Backend call: POST /folders/rename atomically renames every file with the
  // sourcePath prefix to use the new prefix. Pre-validates collisions; a 409
  // with the conflicting path means a file at the destination already has a
  // matching name. No partial state on conflict (verified by Layer 2 test
  // test_folder_rename_aborts_on_collision_no_partial_state).
  const handleDropFolderOnFolder = React.useCallback(
    (sourcePath: string, destinationFolder: string) => {
      void (async () => {
        try {
          // Compute the new folder path.
          const leaf = sourcePath.includes('/')
            ? sourcePath.slice(sourcePath.lastIndexOf('/') + 1)
            : sourcePath;
          const newPath = destinationFolder ? `${destinationFolder}/${leaf}` : leaf;

          // No-op guard (same as FilesTree's isValidMoveTarget but rechecked
          // here in case of stale event paths).
          if (newPath === sourcePath) return;
          // Self / descendant guard. Catches "move A into A" (newPath === A)
          // and "move A into A/B" (which would produce A/B/A and the backend
          // rejects with toPrefix.StartsWith(fromPrefix), but we want the
          // friendlier "cannot move a folder into itself" toast here).
          if (newPath.startsWith(sourcePath + '/') || newPath === sourcePath) {
            toast.error('Cannot move a folder into itself.');
            return;
          }

          await folderRenameMutation.mutateAsync({
            path: { id: docId },
            body: { from: sourcePath, to: newPath },
          });

          // Rewrite ephemeral + expanded sets so any path that was under the
          // old prefix is now under the new one. Without this, an expanded
          // sub-folder collapses (state still references the old path that no
          // longer exists), and an ephemeral folder vanishes.
          const rewritePrefix = (set: Set<string>) => {
            let mutated = false;
            const next = new Set<string>();
            for (const entry of set) {
              if (entry === sourcePath) {
                next.add(newPath);
                mutated = true;
              } else if (entry.startsWith(sourcePath + '/')) {
                next.add(newPath + entry.slice(sourcePath.length));
                mutated = true;
              } else {
                next.add(entry);
              }
            }
            return mutated ? next : set;
          };
          setExpandedFolders((previous) => rewritePrefix(previous));
          setEphemeralFolders((previous) => rewritePrefix(previous));

          toast.success(`Moved folder to "${newPath}"`);
        } catch (error) {
          toast.error(
            getApiErrorMessage(error) ?? `Could not move the folder.`,
          );
        }
      })();
    },
    [docId, folderRenameMutation],
  );

  const openNodeFile = React.useCallback(
    (node: FileTreeNode) => {
      if (node.type !== 'file' || !node.fileId) {
        return;
      }

      onOpenFile({
        fileId: node.fileId,
        filename: node.fullPath,
        contentType: node.contentType ?? null,
        isTextEditable: isTextEditableFile({
          filename: node.fullPath,
          contentType: node.contentType ?? null,
        }),
        category: node.category ?? 'unknown',
        isCollaborative: Boolean(node.isCollaborative),
      });
    },
    [onOpenFile],
  );

  const handleUploadClick = () => {
    if (!canEdit || !hasApiDocumentId || isBusy) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleUploadInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file || !canEdit || !hasApiDocumentId) {
      return;
    }

    openPathDialog({
      title: 'Upload file',
      description: 'Choose the virtual path where this file should be stored.',
      submitLabel: 'Upload',
      initialValue: file.name,
      onSubmit: async (pathValue) => {
        const suggested = pathValue.trim();
        const validationError = getValidationError(suggested);
        if (validationError) {
          throw new Error(validationError);
        }

        const exists = files.some(
          (existing) =>
            (existing.filename ?? '').toLowerCase() === suggested.toLowerCase(),
        );

        const executeUpload = async () => {
          await uploadMutation.mutateAsync({
            path: { id: docId },
            body: {
              file,
              filename: suggested,
            } as any,
          });
          toast.success(`Uploaded "${suggested}"`);
        };

        if (!exists) {
          await executeUpload();
          return;
        }

        openConfirmDialog({
          title: 'Replace existing file?',
          description: `A file named "${suggested}" already exists. Replace it with this upload?`,
          confirmLabel: 'Replace and upload',
          onConfirm: executeUpload,
        });
      },
    });
  };

  const handleRenameFile = (node: FileTreeNode) => {
    if (node.type !== 'file' || !node.fileId || !canEdit || !hasApiDocumentId) {
      return;
    }
    const fileId = node.fileId;

    // Leaf-only rename — matches the folder-rename behavior. Use Move (kebab
    // or drag-and-drop) to change a file's folder; renaming a nested file's
    // path here would silently double as a move, which is surprising.
    const lastSlash = node.fullPath.lastIndexOf('/');
    const parentPrefix = lastSlash >= 0 ? node.fullPath.slice(0, lastSlash + 1) : '';
    const currentLeaf = lastSlash >= 0 ? node.fullPath.slice(lastSlash + 1) : node.fullPath;

    openPathDialog({
      title: 'Rename file',
      description: parentPrefix
        ? `Type just the filename; the file stays inside "${parentPrefix.replace(/\/$/, '')}/". Use Move… to put it in a different folder.`
        : 'Type the new filename (with extension). Use Move… to put it in a folder.',
      submitLabel: 'Save name',
      initialValue: currentLeaf,
      onSubmit: async (nextValue) => {
        const nextLeaf = nextValue.trim();
        if (!nextLeaf || nextLeaf === currentLeaf) {
          return;
        }
        if (nextLeaf.includes('/')) {
          throw new Error('Filename cannot contain "/" — use Move to change the folder.');
        }
        const nextFilename = parentPrefix + nextLeaf;

        const validationError = getValidationError(nextFilename);
        if (validationError) {
          throw new Error(validationError);
        }

        await renameMutation.mutateAsync({
          path: {
            id: docId,
            fileId,
          },
          body: { newFilename: nextFilename },
        });
        toast.success(`Renamed to "${nextFilename}"`);
      },
    });
  };

  const handleRenameFolder = (node: FileTreeNode) => {
    if (node.type !== 'folder' || !canEdit || !hasApiDocumentId) {
      return;
    }

    // Split the folder path into (parent prefix, current leaf name). The
    // rename dialog should only edit the leaf — typing the full path again
    // for a nested folder is friction (and the user nailed it: it's
    // error-prone). The parent gets re-prepended on submit; the folder
    // can't be moved via this dialog (use drag-and-drop or the future
    // explicit Move-folder action for that).
    const lastSlash = node.fullPath.lastIndexOf('/');
    const parentPrefix = lastSlash >= 0 ? node.fullPath.slice(0, lastSlash + 1) : '';
    const currentLeaf = lastSlash >= 0 ? node.fullPath.slice(lastSlash + 1) : node.fullPath;

    const buildNextPath = (nextLeaf: string) => parentPrefix + nextLeaf;

    const filesInFolder = collectFilesByPrefix(flattenedFiles, node.fullPath);
    if (filesInFolder.length === 0) {
      // No files under the prefix — must be an ephemeral folder. Rename it in
      // FE state directly; no backend call needed.
      openPathDialog({
        title: 'Rename folder',
        description: parentPrefix
          ? `This folder is empty (only exists in your session). Renaming updates the leaf only; the folder stays inside "${parentPrefix.replace(/\/$/, '')}/".`
          : "This folder is empty (only exists in your session). Renaming updates the local label.",
        submitLabel: 'Rename folder',
        initialValue: currentLeaf,
        onSubmit: async (nextValue) => {
          const nextLeaf = nextValue.trim();
          if (!nextLeaf || nextLeaf === currentLeaf) return;
          if (nextLeaf.includes('/')) {
            throw new Error('Folder name cannot contain "/" — type just the folder name.');
          }
          const nextPath = buildNextPath(nextLeaf);
          setEphemeralFolders((previous) => {
            const next = new Set(previous);
            next.delete(node.fullPath);
            next.add(nextPath);
            return next;
          });
          toast.success(`Renamed folder to "${nextPath}"`);
        },
      });
      return;
    }

    openPathDialog({
      title: 'Rename folder',
      description: parentPrefix
        ? `Renames all ${filesInFolder.length} file(s) under "${node.fullPath}/" in a single atomic operation. Type just the leaf name; the folder stays inside "${parentPrefix.replace(/\/$/, '')}/".`
        : `Renames all ${filesInFolder.length} file(s) under "${node.fullPath}/" in a single atomic operation. If any target path is already taken the entire rename is rolled back.`,
      submitLabel: 'Rename folder',
      initialValue: currentLeaf,
      onSubmit: async (nextValue) => {
        const nextLeaf = nextValue.trim();
        if (!nextLeaf || nextLeaf === currentLeaf) {
          return;
        }
        if (nextLeaf.includes('/')) {
          throw new Error('Folder name cannot contain "/" — type just the folder name.');
        }
        const nextPath = buildNextPath(nextLeaf);
        // Cheap upfront check so we don't even ship the request when the
        // new folder name is itself malformed (the backend validates too).
        const folderValidationError = getValidationError(
          `${nextPath}/placeholder.txt`,
        );
        if (folderValidationError) {
          throw new Error(
            folderValidationError.replace('/placeholder.txt', ''),
          );
        }

        await folderRenameMutation.mutateAsync({
          path: { id: docId },
          body: { from: node.fullPath, to: nextPath },
        });
        toast.success(`Renamed folder to "${nextPath}"`);
        setExpandedFolders((previous) => {
          const next = new Set(previous);
          next.delete(node.fullPath);
          next.add(nextPath);
          return next;
        });
        // If the renamed folder was tracked as ephemeral, swap the slug too.
        setEphemeralFolders((previous) => {
          if (!previous.has(node.fullPath)) return previous;
          const next = new Set(previous);
          next.delete(node.fullPath);
          next.add(nextPath);
          return next;
        });
      },
    });
  };

  const handleReplaceFile = (node: FileTreeNode) => {
    if (
      node.type !== 'file' ||
      !node.fileId ||
      !canEdit ||
      !hasApiDocumentId ||
      replaceMutation.isPending
    ) {
      return;
    }
    // Stash the target on a ref (not state) so the file-input change handler
    // can read it synchronously — state updates aren't visible until next render.
    replaceTargetRef.current = { fileId: node.fileId, filename: node.fullPath };
    replaceInputRef.current?.click();
  };

  const handleReplaceInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const target = replaceTargetRef.current;
    replaceTargetRef.current = null;

    if (!file || !target || !canEdit || !hasApiDocumentId) {
      return;
    }

    try {
      await replaceMutation.mutateAsync({
        path: { id: docId, oldFileId: target.fileId },
        body: { file } as any,
      });
      toast.success(`Replaced "${target.filename}"`);
    } catch (error) {
      toast.error(
        getApiErrorMessage(error) ?? `Could not replace "${target.filename}".`,
      );
    }
  };

  // Downloads a file via the existing GET /api/documents/{id}/files/{fileId}
  // endpoint. For collab files the backend extracts the live Y.Text content
  // (so unsaved edits ARE included); for static files it returns the stored
  // bytes. Same-origin + HttpOnly cookie means a plain anchor click works
  // without any explicit auth header. The `download` attribute is a
  // suggestion only — browsers strip "/" from it, so nested files land in
  // Downloads as the bare filename (no folder structure preserved on disk,
  // which matches how every browser handles downloads).
  const handleDownloadFile = (node: FileTreeNode) => {
    if (node.type !== 'file' || !node.fileId || !hasApiDocumentId) {
      return;
    }
    const href = `/api/documents/${encodeURIComponent(docId)}/files/${encodeURIComponent(node.fileId)}`;
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = node.name;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleDuplicateFile = async (node: FileTreeNode) => {
    if (node.type !== 'file' || !node.fileId || !canEdit || !hasApiDocumentId) {
      return;
    }
    try {
      const created = await duplicateMutation.mutateAsync({
        path: { id: docId, fileId: node.fileId },
      });
      toast.success(`Created "${created.filename}"`);
    } catch (error) {
      toast.error(
        getApiErrorMessage(error) ?? `Could not duplicate "${node.fullPath}".`,
      );
    }
  };

  const handleDeleteFile = (node: FileTreeNode) => {
    if (node.type !== 'file' || !node.fileId || !canEdit || !hasApiDocumentId) {
      return;
    }
    const fileId = node.fileId;

    openConfirmDialog({
      title: 'Delete file?',
      description: `Delete "${node.fullPath}" permanently?`,
      confirmLabel: 'Delete file',
      destructive: true,
      onConfirm: async () => {
        await deleteMutation.mutateAsync({
          path: {
            id: docId,
            fileId,
          },
        });
        toast.success(`Deleted "${node.fullPath}"`);
      },
    });
  };

  const handleDeleteFolder = (node: FileTreeNode) => {
    if (node.type !== 'folder' || !canEdit || !hasApiDocumentId) {
      return;
    }

    const filesInFolder = collectFilesByPrefix(flattenedFiles, node.fullPath);
    if (filesInFolder.length === 0) {
      // Empty (ephemeral) folder — just drop it from FE state.
      setEphemeralFolders((previous) => {
        if (!previous.has(node.fullPath)) return previous;
        const next = new Set(previous);
        next.delete(node.fullPath);
        return next;
      });
      toast.success(`Folder "${node.fullPath}" removed`);
      return;
    }

    openConfirmDialog({
      title: `Delete folder "${node.fullPath}"?`,
      description: `This will delete the folder and all ${filesInFolder.length} file(s) inside it. Files become recoverable via version restore but not from the file tree.`,
      confirmLabel: `Delete ${filesInFolder.length} file(s)`,
      destructive: true,
      onConfirm: async () => {
        await folderDeleteMutation.mutateAsync({
          path: { id: docId },
          body: { path: node.fullPath },
        });
        toast.success(`Deleted folder "${node.fullPath}"`);
        // Drop from ephemeral tracking too if it was there.
        setEphemeralFolders((previous) => {
          if (!previous.has(node.fullPath)) return previous;
          const next = new Set(previous);
          next.delete(node.fullPath);
          return next;
        });
      },
    });
  };

  const toggleFolder = (fullPath: string) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(fullPath)) {
        next.delete(fullPath);
      } else {
        next.add(fullPath);
      }
      return next;
    });
  };

  const handlePathDialogSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pathActionRef.current) return;

    setDialogBusy(true);
    try {
      await pathActionRef.current(pathInput);
      closePathDialog();
    } catch (error) {
      toast.error(getApiErrorMessage(error) ?? 'Action failed.');
    } finally {
      setDialogBusy(false);
    }
  };

  const handleConfirmDialogSubmit = async () => {
    if (!confirmActionRef.current) return;

    setDialogBusy(true);
    try {
      await confirmActionRef.current();
      closeConfirmDialog();
    } catch (error) {
      toast.error(getApiErrorMessage(error) ?? 'Action failed.');
    } finally {
      setDialogBusy(false);
    }
  };

  if (!hasApiDocumentId) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
        File management is available only for saved API documents.
      </div>
    );
  }

  const projectTitle = (documentTitle ?? '').trim() || 'Untitled project';
  const isEntrypointActive = activeFilePath === mainEntrypoint;

  // Synthetic FileTreeNode for the entrypoint so we can reuse the per-file
  // action handlers (rename / move / duplicate) from the row kebab. The
  // entrypoint isn't rendered as a tree row anymore (it lives in the header),
  // but it's still a regular file under the hood — backend's RenameFileAsync
  // updates Document.Entrypoint atomically when the entrypoint is renamed.
  const entrypointNode: FileTreeNode | null = mainFile?.id
    ? {
        type: 'file',
        name: mainEntrypoint.includes('/')
          ? mainEntrypoint.slice(mainEntrypoint.lastIndexOf('/') + 1)
          : mainEntrypoint,
        fullPath: mainEntrypoint,
        fileId: mainFile.id,
        contentType: mainFile.contentType ?? null,
        size: typeof mainFile.size === 'number' ? mainFile.size : undefined,
        isCollaborative: true,
      }
    : null;

  return (
    <section className="space-y-3">
      {/* Project header: title on the left, entrypoint pill on the right.
          The pill is clickable (focuses the main editor tab) and shows the
          full path so the entrypoint's folder context isn't lost when it
          lives inside a subfolder (e.g. "src/main.tex"). */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/70 px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {projectTitle}
            </h3>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {projectTitle}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onOpenMainFile?.()}
              className={`flex max-w-[55%] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                isEntrypointActive
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
              aria-label={`Open entrypoint ${mainEntrypoint}`}
            >
              <FileCode2 className="size-3 shrink-0 text-sky-500" />
              <span className="truncate">{mainEntrypoint}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Entrypoint: {mainEntrypoint}
          </TooltipContent>
        </Tooltip>
        {canEdit && entrypointNode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={isBusy}
                aria-label="Entrypoint actions"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onOpenMainFile?.()}>
                <FileCode2 className="size-3.5" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRenameFile(entrypointNode)}>
                <Pencil className="size-3.5" />
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMoveDialogTarget(entrypointNode)}>
                <FolderInput className="size-3.5" />
                Move…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleDuplicateFile(entrypointNode)}
              >
                <Copy className="size-3.5" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownloadFile(entrypointNode)}>
                <Download className="size-3.5" />
                Download
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Action row: section label + action buttons. Hidden file inputs sit
          here so their click handlers stay in scope. */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Files
        </h3>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(event) => void handleUploadInputChange(event)}
          />
          <input
            ref={replaceInputRef}
            type="file"
            accept={ACCEPTED_FILE_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(event) => void handleReplaceInputChange(event)}
          />
          {canEdit && (
            <>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setNewFileInitialFolder('');
                  setNewFileDialogOpen(true);
                }}
                disabled={isBusy}
              >
                <Plus className="size-3" />
                File
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setNewFolderReturnTo(null);
                  setNewFolderDialogOpen(true);
                }}
                disabled={isBusy}
              >
                <FolderPlus className="size-3" />
                Folder
              </Button>
            </>
          )}
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={handleUploadClick}
            disabled={!canEdit || isBusy}
          >
            {uploadMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
            Upload
          </Button>
        </div>
      </div>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          You can browse and open files, but editing file metadata requires
          editor access.
        </p>
      )}

      <div className="max-h-[52vh] overflow-auto rounded-lg border border-border bg-card/70 p-1">
        <FilesTree
          tree={tree}
          isLoading={filesQuery.isPending}
          isError={filesQuery.isError}
          canEdit={canEdit}
          isBusy={isBusy}
          docId={docId}
          expandedFolders={expandedFolders}
          activeFilePath={activeFilePath}
          mainEntrypoint={mainEntrypoint}
          editingUsersByPath={editingUsersByPath}
          onToggleFolder={toggleFolder}
          onOpenFileNode={openNodeFile}
          onRenameFile={handleRenameFile}
          onReplaceFile={handleReplaceFile}
          onDeleteFile={handleDeleteFile}
          onDuplicateFile={(node) => void handleDuplicateFile(node)}
          onDownloadFile={handleDownloadFile}
          onMoveFile={(node) => setMoveDialogTarget(node)}
          onDropFileOnFolder={handleDropFileOnFolder}
          onDropFolderOnFolder={handleDropFolderOnFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onSetEntrypoint={onSetEntrypoint}
        />
      </div>

      <PathInputDialog
        state={pathDialog}
        value={pathInput}
        busy={dialogBusy}
        onValueChange={setPathInput}
        onSubmit={(event) => void handlePathDialogSubmit(event)}
        onClose={closePathDialog}
      />

      <ConfirmActionDialog
        state={confirmDialog}
        busy={dialogBusy}
        onConfirm={() => void handleConfirmDialogSubmit()}
        onClose={closeConfirmDialog}
      />

      <NewFileDialog
        open={newFileDialogOpen}
        busy={uploadMutation.isPending}
        folderOptions={folderOptions}
        initialFolder={newFileInitialFolder}
        validate={(folder, filename) => {
          const full = folder ? `${folder}/${filename}` : filename;
          return getValidationError(full);
        }}
        onSubmit={handleCreateFileFromDialog}
        onRequestNewFolder={() => {
          setNewFolderReturnTo('newFile');
          setNewFileDialogOpen(false);
          setNewFolderDialogOpen(true);
        }}
        onClose={() => setNewFileDialogOpen(false)}
      />

      <NewFolderDialog
        open={newFolderDialogOpen}
        busy={false}
        existingFolders={allFolderSet}
        onSubmit={handleCreateEphemeralFolder}
        onClose={() => {
          setNewFolderDialogOpen(false);
          setNewFolderReturnTo(null);
        }}
      />

      {moveDialogTarget && (
        <MoveFileDialog
          open={moveDialogTarget !== null}
          busy={renameMutation.isPending}
          filename={moveDialogTarget.fullPath}
          currentFolder={(() => {
            const slash = moveDialogTarget.fullPath.lastIndexOf('/');
            return slash >= 0
              ? moveDialogTarget.fullPath.slice(0, slash)
              : '';
          })()}
          folderOptions={folderOptions}
          onSubmit={(dest) => handleMoveFile(moveDialogTarget, dest)}
          onRequestNewFolder={() => {
            setNewFolderReturnTo('moveFile');
            // Keep moveDialogTarget set so the dialog re-renders with the
            // new folder picked up via folderOptions after creation.
            setNewFolderDialogOpen(true);
          }}
          onClose={() => setMoveDialogTarget(null)}
        />
      )}
    </section>
  );
};
