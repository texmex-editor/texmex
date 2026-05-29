import type { FileCategory } from '@/utils/fileCategories';

export type EditingUser = {
  id: string;
  name: string;
  color: string;
};

export type OpenFilePayload = {
  fileId: string;
  filename: string;
  contentType: string | null;
  isTextEditable: boolean;
  category: FileCategory;
  isCollaborative: boolean;
};

export type FilesTabProps = {
  docId: string;
  hasApiDocumentId: boolean;
  canEdit: boolean;
  /** The document's title; rendered in the panel header so the user has
   *  project context next to the entrypoint pill. Falls back to "Untitled". */
  documentTitle?: string | null;
  entrypoint?: string;
  mainEntrypointByteSize?: number;
  onOpenMainFile?: () => void;
  onOpenFile: (file: OpenFilePayload) => void;
  /** Set a new entrypoint by filename. When undefined the file tree hides
   *  its 'Set as main file' button (e.g. non-owners). */
  onSetEntrypoint?: (filename: string) => void;
  activeFilePath: string | null;
  editingUsersByPath?: Record<string, EditingUser[]>;
};

export type PathDialogState = {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
};

export type ConfirmDialogState = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
};
