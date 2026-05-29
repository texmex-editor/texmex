import type { DetectedFormula } from '@/snippets/formula/formulaUtils';
import {
  applySnippetInsertion,
  parseSnippetInsertion,
  type SnippetInsertion,
} from '@/snippets/snippetInsertion';
import type { FileResponse } from '@/client';
import type { DocumentSettings } from '@/components/DocumentSettingsDialog';
import type {
  AwarenessPresenceUser,
  EditorSetup,
  FileEventMessage,
} from '@/utils/editor';
import {
  buildImageFigureSnippet,
  buildUniquePath,
  inferImageExtension,
  isSupportedLatexImage,
  sanitizeFilenameSegment,
  splitFilename,
  BASIC_LATEX_TEMPLATE,
  type OpenEditorFile,
} from './fileEditorUtils';
import { extractDocumentSettings } from './documentSettings';
import {
  isCategoryTextEditable,
  normalizeFileCategory,
  type FileCategory,
} from '@/utils/fileCategories';
import type { FormulaOverlayState } from './useEditorSelectionOverlay';
import type { DocumentRole } from './useEditorDocument';
import type { MutableRefObject } from 'react';

type OpenFileRequest = {
  fileId: string;
  filename: string;
  contentType: string | null;
  isTextEditable: boolean;
  category: FileCategory;
  isCollaborative: boolean;
};

export type ReplaceBannerState = {
  oldFileId: string;
  oldIsCollaborative: boolean;
  newFileId: string;
  newFilename: string;
  newContentType: string | null;
  newCategory: FileCategory;
  newIsCollaborative: boolean;
  uploadedByDisplayName: string | null;
};

export type EditorSessionContext = {
  docId: string;
  hasApiDocumentId: boolean;
  entrypointFileId: string | null;
  activeCollaborativeFileId: string | null;
  isActiveCollaborativeTab: boolean;
  isMainTabActive: boolean;
  activeFileCategory: FileCategory | null;
  activeFileTab: OpenEditorFile | null;
  currentUserDisplayName: string | null;
  filesById: Map<string, FileResponse>;
  replaceBanner: ReplaceBannerState | null;
  isViewer: boolean;
  mainEditorSetupRef: MutableRefObject<EditorSetup | null>;
  fileEditorSetupRef: MutableRefObject<EditorSetup | null>;
  activeEditorSetupRef: MutableRefObject<EditorSetup | null>;
  setEditorSetup: (setup: EditorSetup | null) => void;
  setDocumentText: (text: string) => void;
  setCurrentSettings: (settings: DocumentSettings) => void;
  scheduleCompile: () => void;
  triggerCompile: () => Promise<void>;
  setActiveEditorTabKey: (key: string) => void;
  handleOpenFileTab: (file: OpenFileRequest) => void;
  closeFileTabById: (fileId: string) => void;
  updateFileTabById: (
    fileId: string,
    update: Partial<Omit<OpenEditorFile, 'key' | 'fileId'>>,
  ) => void;
  refreshStaticTextTab: (fileId: string) => Promise<void>;
  refreshFileList: () => Promise<void>;
  updateFileListCache: (
    updater: (files: FileResponse[]) => FileResponse[],
  ) => void;
  setReplaceBanner: (next: ReplaceBannerState | null) => void;
  setAwarenessUsers: (users: AwarenessPresenceUser[]) => void;
  setEditingUsersByPath: (
    users: Record<string, AwarenessPresenceUser[]>,
  ) => void;
  setRuntimeRole: (role: DocumentRole) => void;
  setStatusState: (text: string, cls: string) => void;
  notifications: NotificationAdapter;
  documentFiles: DocumentFilesAdapter;
  editorAdapter: EditorAdapter;
  collaborationAdapter: CollaborationAdapter;
  formulaOverlay: FormulaOverlayState | null;
  activeFormulaRef: MutableRefObject<DetectedFormula | null>;
  setActiveFormula: (formula: DetectedFormula | null) => void;
  setIsFormulaDialogOpen: (open: boolean) => void;
};

export type NotificationAdapter = {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

export type DocumentFilesAdapter = {
  listFiles: (docId: string) => Promise<FileResponse[]>;
  uploadFile: (
    docId: string,
    file: File,
    filename: string,
  ) => Promise<void>;
};

export type EditorAdapter = {
  ensureLatexPackage: (editor: any, pkg: string) => void;
  getDropPosition: (editor: any, clientX: number, clientY: number) => any | null;
  setPosition: (editor: any, position: any) => void;
  insertSnippet: (editor: any, snippet: string, position: any) => void;
  getValue: (editor: any) => string;
  replaceFormula: (editor: any, formula: any, nextBody: string) => void;
  wrapSelection: (editor: any, before: string, after: string) => void;
  unwrapSelection: (editor: any, before: string, after: string) => void;
  replaceAllContent: (editor: any, tag: string, content: string) => boolean;
};

export type CollaborationAdapter = {
  onAwarenessChange: (cb: (users: any[]) => void) => () => void;
  sendFileEvent: (ev: unknown) => void;
};

function tryHandleInternalFileDrag(
  editorAdapter: any,
  editor: any,
  snippet: string,
  clientX: number,
  clientY: number,
  isMainTabActive: boolean,
): boolean {
  if (!editor) return false;
  try {
    const parsed = JSON.parse(snippet);
    if (!parsed || parsed.type !== 'file' || typeof parsed.path !== 'string') {
      return false;
    }

    const path: string = parsed.path;
    const dropPosition = editorAdapter.getDropPosition(editor, clientX, clientY);
    if (dropPosition) editorAdapter.setPosition(editor, dropPosition);

    if (parsed.isImage) {
      const latexInsert = buildImageFigureSnippet(path);
      if (isMainTabActive) {
        editorAdapter.ensureLatexPackage(editor, 'graphicx');
      }
      editorAdapter.insertSnippet(editor, latexInsert, dropPosition);
      return true;
    }

    if (parsed.isLatex) {
      const latexInsert = `\\input{${path}}`;
      editorAdapter.insertSnippet(editor, latexInsert, dropPosition);
      return true;
    }

    editorAdapter.insertSnippet(editor, path, dropPosition);
    return true;
  } catch {
    return false;
  }
}

export class EditorSession {
  private context: EditorSessionContext;

  constructor(context: EditorSessionContext) {
    this.context = context;
  }

  update(context: EditorSessionContext) {
    this.context = context;
  }

  handleEditorReady = (setup: EditorSetup) => {
    const {
      mainEditorSetupRef,
      activeEditorSetupRef,
      isActiveCollaborativeTab,
      setEditorSetup,
      entrypointFileId,
      activeCollaborativeFileId,
      setDocumentText,
      setCurrentSettings,
      triggerCompile,
      editorAdapter,
    } = this.context;

    mainEditorSetupRef.current = setup;
    if (isActiveCollaborativeTab) {
      activeEditorSetupRef.current = setup;
    }
    setEditorSetup(setup);
    if (!entrypointFileId || activeCollaborativeFileId === entrypointFileId) {
      const documentContent = editorAdapter.getValue(setup.editor);
      setDocumentText(documentContent);
      const extractedSettings = extractDocumentSettings(documentContent);
      setCurrentSettings(extractedSettings);
      setTimeout(() => {
        void triggerCompile();
      }, 1200);
    }
  };

  handleFileEditorReady = (setup: EditorSetup) => {
    const { fileEditorSetupRef, isActiveCollaborativeTab, activeEditorSetupRef } =
      this.context;
    fileEditorSetupRef.current = setup;
    if (!isActiveCollaborativeTab) {
      activeEditorSetupRef.current = setup;
    }
  };

  handleDocChange = () => {
    const {
      entrypointFileId,
      activeCollaborativeFileId,
      scheduleCompile,
      mainEditorSetupRef,
      setDocumentText,
      setCurrentSettings,
    } = this.context;
    if (!entrypointFileId || !activeCollaborativeFileId) {
      return;
    }

    scheduleCompile();

    if (activeCollaborativeFileId !== entrypointFileId) {
      return;
    }

    const editorInstance = mainEditorSetupRef.current?.editor;
    if (!editorInstance) return;
    const editorAdapter = this.context.editorAdapter;
    const newText = editorAdapter.getValue(editorInstance);
    setDocumentText(newText);
    const extractedSettings = extractDocumentSettings(newText);
    setCurrentSettings(extractedSettings);
  };

  handleSnippetInsert = (insertion: SnippetInsertion) => {
    const { activeEditorSetupRef, mainEditorSetupRef } = this.context;
    const editor = activeEditorSetupRef.current?.editor;
    if (!editor) {
      return;
    }

    applySnippetInsertion(mainEditorSetupRef.current?.editor, editor, insertion);
  };

  handleOpenFormulaDialog = () => {
    const {
      formulaOverlay,
      activeFormulaRef,
      setActiveFormula,
      setIsFormulaDialogOpen,
    } = this.context;
    if (!formulaOverlay) {
      return;
    }

    activeFormulaRef.current = formulaOverlay;
    setActiveFormula(formulaOverlay);
    setIsFormulaDialogOpen(true);
  };

  handleSaveFormula = (nextBody: string) => {
    const {
      activeEditorSetupRef,
      activeFormulaRef,
      setIsFormulaDialogOpen,
      setActiveFormula,
    } = this.context;
    const editor = activeEditorSetupRef.current?.editor;
    const formula = activeFormulaRef.current;
    if (!editor || !formula) {
      return;
    }

    const editorAdapter = this.context.editorAdapter;
    editorAdapter.replaceFormula(editor, formula, nextBody);
    setIsFormulaDialogOpen(false);
    setActiveFormula(null);
    activeFormulaRef.current = null;
  };

  handleFormulaDialogChange = (open: boolean) => {
    const { setIsFormulaDialogOpen, setActiveFormula, activeFormulaRef } =
      this.context;
    setIsFormulaDialogOpen(open);
    if (!open) {
      setActiveFormula(null);
      activeFormulaRef.current = null;
    }
  };

  handleSnippetDrop = (snippet: string, clientX: number, clientY: number) => {
    const {
      activeEditorSetupRef,
      isViewer,
      isMainTabActive,
      activeFileCategory,
      mainEditorSetupRef,
      filesById,
    } = this.context;
    const editor = activeEditorSetupRef.current?.editor;
    const canEditActiveFile =
      !isViewer && (isMainTabActive || activeFileCategory === 'collaborative');
    if (!editor || !canEditActiveFile) return;

    // First, try internal JSON payload (dragging from in-app file tree)
    const handled = tryHandleInternalFileDrag(
      this.context.editorAdapter,
      editor,
      snippet,
      clientX,
      clientY,
      isMainTabActive,
    );
    if (handled) return;

    // Fallback: some browsers only expose text/plain for drag data. Try to
    // interpret the plain text as a path and match it against known files.
    try {
      const raw = (snippet ?? '').trim();
      if (raw) {
        // If the payload is already JSON (some platforms), attempt to handle it
        if (raw.startsWith('{') || raw.startsWith('[')) {
          try {
            const handledJson = tryHandleInternalFileDrag(
              this.context.editorAdapter,
              editor,
              raw,
              clientX,
              clientY,
              isMainTabActive,
            );
            if (handledJson) return;
          } catch {
            // fall back to path matching
          }
        }

        // Normalize candidate path to a forward-slash form and strip leading ./ or C:\ etc
        const pathCandidate = raw.replace(/^\.?\//, '').replace(/\\\\/g, '/').replace(/\\/g, '/');
        const lowerPath = pathCandidate.toLowerCase();

        // Try to match against known files with multiple heuristics (exact, endsWith, includes)
        let matchedFile: FileResponse | null = null;

        // 1) exact match on normalized filename
        for (const file of filesById.values()) {
          const filename = (file.filename ?? '').trim();
          if (!filename) continue;
          const filenameNorm = filename.replace(/^\.?\//, '').replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
          if (filenameNorm === lowerPath) {
            matchedFile = file;
            break;
          }
        }

        // 2) endsWith match (images/foo.png vs foo.png)
        if (!matchedFile) {
          for (const file of filesById.values()) {
            const filename = (file.filename ?? '').trim();
            if (!filename) continue;
            const filenameNorm = filename.replace(/^\.?\//, '').replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
            if (filenameNorm.endsWith('/' + lowerPath) || lowerPath.endsWith('/' + filenameNorm)) {
              matchedFile = file;
              break;
            }
          }
        }

        // 3) substring match as a last resort
        if (!matchedFile) {
          for (const file of filesById.values()) {
            const filename = (file.filename ?? '').trim();
            if (!filename) continue;
            const filenameNorm = filename.replace(/^\.?\//, '').replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
            if (filenameNorm.includes(lowerPath) || lowerPath.includes(filenameNorm)) {
              matchedFile = file;
              break;
            }
          }
        }

        if (matchedFile) {
          const isImage = (matchedFile.contentType ?? '').toLowerCase().startsWith('image/') || /\.(png|jpe?g|gif|svg|webp|bmp|tif|tiff)$/i.test(matchedFile.filename ?? '');
          const isLatex = /\.(tex|bib|sty|cls|tikz|pgf|cfg|txt)$/i.test(matchedFile.filename ?? '');

          const payload = {
            type: 'file',
            path: matchedFile.filename ?? pathCandidate,
            fileId: matchedFile.id ?? null,
            isImage,
            isLatex,
            contentType: matchedFile.contentType ?? null,
          } as const;

          const handledByPath = tryHandleInternalFileDrag(
            this.context.editorAdapter,
            editor,
            JSON.stringify(payload),
            clientX,
            clientY,
            isMainTabActive,
          );
          if (handledByPath) return;
        }
      }
    } catch (e) {
      // ignore and fall back to default insertion
    }

    const editorAdapter = this.context.editorAdapter;
    const dropPosition = editorAdapter.getDropPosition(editor, clientX, clientY);
    if (dropPosition) editorAdapter.setPosition(editor, dropPosition);

    // If the dragged payload was a plain path (text/plain) try to detect
    // image or LaTeX files and insert the appropriate snippet instead of
    // inserting the raw path string.
    const rawText = (snippet ?? '').trim();

    // Try to extract a path-like substring (handles absolute or relative paths
    // and Windows backslashes).
    const pathLikeMatch = rawText.match(/(?:[A-Za-z]:)?[\\\/\w .@()\-\[\]]+\.(png|jpe?g|gif|svg|webp|bmp|tif|tiff|tex|bib|sty|cls|tikz|pgf|cfg|txt)(?:\?.*)?/i);
    const pathCandidate = pathLikeMatch ? pathLikeMatch[0].replace(/\\/g, '/').replace(/^\.\/?/, '') : rawText;

    const imageRegex = /\.(png|jpe?g|gif|svg|webp|bmp|tif|tiff)(?:\?.*)?$/i;
    const latexRegex = /\.(tex|bib|sty|cls|tikz|pgf|cfg|txt)(?:\?.*)?$/i;

    if (pathCandidate) {
      // Try to match against known files and synthesize an internal payload if possible.
      let matchedFile: FileResponse | null = null;

      const lowerPath = pathCandidate.toLowerCase();
      for (const file of filesById.values()) {
        const filenameNorm = (file.filename ?? '').replace(/\\/g, '/').replace(/^\.\/?/, '').toLowerCase();
        if (!filenameNorm) continue;
        if (filenameNorm === lowerPath || filenameNorm.endsWith('/' + lowerPath) || lowerPath.endsWith('/' + filenameNorm) || filenameNorm.includes(lowerPath) || lowerPath.includes(filenameNorm)) {
          matchedFile = file;
          break;
        }
      }

      if (matchedFile) {
        const isImage = (matchedFile.contentType ?? '').toLowerCase().startsWith('image/') || imageRegex.test(matchedFile.filename ?? '');
        const isLatex = latexRegex.test(matchedFile.filename ?? '');
        const payload = {
          type: 'file',
          path: matchedFile.filename ?? pathCandidate,
          fileId: matchedFile.id ?? null,
          isImage,
          isLatex,
          contentType: matchedFile.contentType ?? null,
        } as const;

        const handledByPath = tryHandleInternalFileDrag(
          this.context.editorAdapter,
          editor,
          JSON.stringify(payload),
          clientX,
          clientY,
          isMainTabActive,
        );
        if (handledByPath) return;
      }

      // No matched file, but pathCandidate looks like an image or .tex path —
      // insert the appropriate LaTeX wrapper.
      if (imageRegex.test(pathCandidate)) {
        if (isMainTabActive) {
          editorAdapter.ensureLatexPackage(editor, 'graphicx');
        }
        const latexInsert = buildImageFigureSnippet(pathCandidate);
        editorAdapter.insertSnippet(editor, latexInsert, dropPosition);
        return;
      }

      if (latexRegex.test(pathCandidate)) {
        const latexInsert = `\\input{${pathCandidate}}`;
        editorAdapter.insertSnippet(editor, latexInsert, dropPosition);
        return;
      }
    }

    const insertion: SnippetInsertion =
      parseSnippetInsertion(snippet) ?? { text: snippet };
    applySnippetInsertion(
      mainEditorSetupRef.current?.editor,
      editor,
      insertion,
      dropPosition ?? undefined,
    );
  };

  handleFileDrop = async (files: File[], clientX: number, clientY: number) => {
    const {
      activeEditorSetupRef,
      isViewer,
      isMainTabActive,
      activeFileCategory,
      hasApiDocumentId,
      docId,
      refreshFileList,
      notifications,
      documentFiles,
    } = this.context;
    const editor = activeEditorSetupRef.current?.editor;
    const canEditActiveFile =
      !isViewer && (isMainTabActive || activeFileCategory === 'collaborative');
    if (!editor || !canEditActiveFile) {
      return;
    }
    if (!hasApiDocumentId) {
      notifications.error('Save this document first to upload dropped images.');
      return;
    }

    const droppedImages = files.filter((file) =>
      file.type.startsWith('image/'),
    );
    if (droppedImages.length === 0) {
      notifications.error('Only image files can be dropped into the editor.');
      return;
    }
    const supportedImages = droppedImages.filter(isSupportedLatexImage);
    const unsupportedImages = droppedImages.filter(
      (file) => !isSupportedLatexImage(file),
    );
    if (supportedImages.length === 0) {
      notifications.error(
        'Only PNG and JPEG images are supported for LaTeX compile.',
      );
      return;
    }

    const editorAdapter = this.context.editorAdapter;
    const dropPosition = editorAdapter.getDropPosition(editor, clientX, clientY);
    if (dropPosition) {
      editorAdapter.setPosition(editor, dropPosition);
    }

    try {
      const existingFiles = await documentFiles.listFiles(docId);
      const existingPaths = new Set(
        (existingFiles ?? [])
          .map((file) => (file.filename ?? '').trim().toLowerCase())
          .filter(Boolean),
      );
      const uploadedPaths: string[] = [];

      for (const image of supportedImages) {
        const safeNameBase = sanitizeFilenameSegment(image.name);
        const { stem, extension } = splitFilename(safeNameBase);
        const inferredExtension = extension || inferImageExtension(image.type);
        const safeName = `${stem || 'image'}${inferredExtension}`;
        const desiredPath = `images/${safeName}`;
        const finalPath = buildUniquePath(desiredPath, existingPaths);

        await documentFiles.uploadFile(docId, image, finalPath);

        uploadedPaths.push(finalPath);
      }

      if (unsupportedImages.length > 0) {
        notifications.error(
          `Skipped ${unsupportedImages.length} unsupported image(s) (use PNG or JPEG).`,
        );
      }

      const latexInsert = uploadedPaths
        .map((path) => buildImageFigureSnippet(path))
        .join('\n\n');
      if (isMainTabActive) {
        editorAdapter.ensureLatexPackage(editor, 'graphicx');
      }
      editorAdapter.insertSnippet(editor, latexInsert, dropPosition);

      await refreshFileList();

      notifications.success(
        uploadedPaths.length === 1
          ? `Inserted image "${uploadedPaths[0]}".`
          : `Inserted ${uploadedPaths.length} images.`,
      );
    } catch {
      notifications.error('Could not upload dropped image(s).');
    }
  };

  handleApplyVersion = (sourceText: string) => {
    const { isMainTabActive, mainEditorSetupRef, setDocumentText, setCurrentSettings } =
      this.context;
    if (!isMainTabActive) {
      this.context.notifications.error(
        'Switch to the main document tab to apply versions.',
      );
      return;
    }

    const editor = mainEditorSetupRef.current?.editor;
    if (!editor) {
      return;
    }

    const replaced = this.context.editorAdapter.replaceAllContent(
      editor,
      'version.apply',
      sourceText,
    );
    if (!replaced) {
      return;
    }
    setDocumentText(sourceText);
    const extractedSettings = extractDocumentSettings(sourceText);
    setCurrentSettings(extractedSettings);
    this.context.notifications.success('Version applied');
  };

  handleInsertBasicTemplate = () => {
    const { isMainTabActive, mainEditorSetupRef, setDocumentText, setCurrentSettings, scheduleCompile } =
      this.context;
    if (!isMainTabActive) {
      this.context.notifications.error(
        'Switch to the main document tab to insert templates.',
      );
      return;
    }

    const editor = mainEditorSetupRef.current?.editor;
    if (!editor) {
      return;
    }

    const replaced = this.context.editorAdapter.replaceAllContent(
      editor,
      'template.insert',
      BASIC_LATEX_TEMPLATE,
    );
    if (!replaced) {
      return;
    }
    setDocumentText(BASIC_LATEX_TEMPLATE);
    const extractedSettings = extractDocumentSettings(BASIC_LATEX_TEMPLATE);
    setCurrentSettings(extractedSettings);
    scheduleCompile();
    this.context.notifications.success('Basic LaTeX template inserted');
  };

  handleWrapSelection = (before: string, after: string) => {
    const { activeEditorSetupRef } = this.context;
    const editor = activeEditorSetupRef.current?.editor;
    if (editor) {
      this.context.editorAdapter.wrapSelection(editor, before, after);
    }
  };

  handleUnwrapSelection = (before: string, after: string) => {
    const { activeEditorSetupRef } = this.context;
    const editor = activeEditorSetupRef.current?.editor;
    if (editor) {
      this.context.editorAdapter.unwrapSelection(editor, before, after);
    }
  };

  handleOpenFile = (file: OpenFileRequest) => {
    const { entrypointFileId, setActiveEditorTabKey, handleOpenFileTab } =
      this.context;
    if (entrypointFileId && file.fileId === entrypointFileId) {
      setActiveEditorTabKey('main');
      return;
    }
    handleOpenFileTab(file);
  };

  handleOpenReplacedFile = () => {
    const { replaceBanner, closeFileTabById, mainEditorSetupRef, setReplaceBanner } =
      this.context;
    if (!replaceBanner) {
      return;
    }

    closeFileTabById(replaceBanner.oldFileId);
    mainEditorSetupRef.current?.unlockCollaboration?.();
    this.handleOpenFile({
      fileId: replaceBanner.newFileId,
      filename: replaceBanner.newFilename,
      contentType: replaceBanner.newContentType,
      isTextEditable: isCategoryTextEditable(replaceBanner.newCategory),
      category: replaceBanner.newCategory,
      isCollaborative: replaceBanner.newIsCollaborative,
    });
    setReplaceBanner(null);
  };

  handleCloseReplaceBanner = () => {
    const { replaceBanner, closeFileTabById, mainEditorSetupRef, setReplaceBanner } =
      this.context;
    if (!replaceBanner) {
      return;
    }

    closeFileTabById(replaceBanner.oldFileId);
    mainEditorSetupRef.current?.unlockCollaboration?.();
    setReplaceBanner(null);
  };

  handleFileEvent = (message: FileEventMessage) => {
    const {
      activeFileTab,
      closeFileTabById,
      currentUserDisplayName,
      entrypointFileId,
      isMainTabActive,
      refreshFileList,
      refreshStaticTextTab,
      updateFileListCache,
      updateFileTabById,
      setReplaceBanner,
      mainEditorSetupRef,
    } = this.context;
    if (message.type !== 'file_event' || !message.action) {
      return;
    }

    const action = message.action;
    if (action === 'created' || action === 'replaced') {
      const payload = message as FileEventMessage & {
        fileId: string;
        filename: string;
        contentType?: string | null;
        isCollaborative?: boolean;
        category?: string | null;
        uploadedByDisplayName?: string | null;
      };
      if (!payload.fileId) return;

      const normalizedCategory = normalizeFileCategory(payload.category);
      updateFileListCache((existing) => {
        const existingFile = existing.find((file) => file.id === payload.fileId);
        const nextFile: FileResponse = {
          ...(existingFile ?? {}),
          id: payload.fileId,
          filename: payload.filename,
          contentType: payload.contentType ?? null,
          isCollaborative: payload.isCollaborative ?? false,
          category: normalizedCategory,
          uploadedByDisplayName: payload.uploadedByDisplayName ?? null,
        };
        return existingFile
          ? existing.map((file) =>
              file.id === payload.fileId ? nextFile : file,
            )
          : [...existing, nextFile];
      });

      updateFileTabById(payload.fileId, {
        filename: payload.filename,
        contentType: payload.contentType ?? null,
        category: normalizedCategory,
        isCollaborative: payload.isCollaborative ?? false,
      });

      if (action === 'replaced') {
        if (
          activeFileTab?.fileId === payload.fileId ||
          (isMainTabActive && entrypointFileId === payload.fileId)
        ) {
          const uploader = payload.uploadedByDisplayName?.trim() || 'Someone';
          this.context.notifications.info(
            `${uploader} replaced this file. Your unsaved edits may be lost.`,
          );
        }

        if (normalizedCategory === 'static_text') {
          void refreshStaticTextTab(payload.fileId);
        }
      }

      void refreshFileList();
      return;
    }

    if (action === 'renamed') {
      const payload = message as FileEventMessage & {
        fileId: string;
        filename: string;
        category?: string | null;
      };
      if (!payload.fileId) return;

      const normalizedCategory = normalizeFileCategory(payload.category);
      updateFileListCache((existing) =>
        existing.map((file) =>
          file.id === payload.fileId
            ? {
                ...file,
                filename: payload.filename,
                category: normalizedCategory,
              }
            : file,
        ),
      );

      updateFileTabById(payload.fileId, {
        filename: payload.filename,
        category: normalizedCategory,
      });
      return;
    }

    if (action === 'deleted') {
      const payload = message as FileEventMessage & { fileId: string };
      if (!payload.fileId) return;

      updateFileListCache((existing) =>
        existing.filter((file) => file.id !== payload.fileId),
      );

    if (activeFileTab?.fileId === payload.fileId) {
        this.context.notifications.error(
          'This file was deleted by another user.',
        );
    }
      closeFileTabById(payload.fileId);
      return;
    }

    if (action === 'replaced_cross_type') {
      const payload = message as FileEventMessage & {
        oldFileId: string;
        oldIsCollaborative?: boolean;
        fileId: string;
        filename: string;
        contentType?: string | null;
        isCollaborative?: boolean;
        category?: string | null;
        uploadedByDisplayName?: string | null;
      };
      if (!payload.oldFileId || !payload.fileId) return;

      const normalizedCategory = normalizeFileCategory(payload.category);
      updateFileListCache((existing) => {
        const withoutOld = existing.filter(
          (file) => file.id !== payload.oldFileId,
        );
        const nextFile: FileResponse = {
          id: payload.fileId,
          filename: payload.filename,
          contentType: payload.contentType ?? null,
          isCollaborative: payload.isCollaborative ?? false,
          category: normalizedCategory,
          uploadedByDisplayName: payload.uploadedByDisplayName ?? null,
        };
        return [...withoutOld, nextFile];
      });

      void refreshFileList();

      const isActiveOldFile =
        activeFileTab?.fileId === payload.oldFileId ||
        (isMainTabActive && entrypointFileId === payload.oldFileId);

      const isSelfReplace =
        payload.uploadedByDisplayName &&
        currentUserDisplayName &&
        payload.uploadedByDisplayName === currentUserDisplayName;

      if (!isActiveOldFile) {
        closeFileTabById(payload.oldFileId);
        if (!isSelfReplace) {
          const uploader = payload.uploadedByDisplayName?.trim() || 'Someone';
          this.context.notifications.info(
            `${uploader} replaced "${payload.filename}". The old file was closed.`,
          );
        }
        return;
      }

      if (isSelfReplace) {
        closeFileTabById(payload.oldFileId);
        mainEditorSetupRef.current?.unlockCollaboration?.();
        this.handleOpenFile({
          fileId: payload.fileId,
          filename: payload.filename,
          contentType: payload.contentType ?? null,
          isTextEditable: isCategoryTextEditable(normalizedCategory),
          category: normalizedCategory,
          isCollaborative: payload.isCollaborative ?? false,
        });
        return;
      }

      if (payload.oldIsCollaborative) {
        mainEditorSetupRef.current?.lockCollaboration?.();
      }

      setReplaceBanner({
        oldFileId: payload.oldFileId,
        oldIsCollaborative: Boolean(payload.oldIsCollaborative),
        newFileId: payload.fileId,
        newFilename: payload.filename,
        newContentType: payload.contentType ?? null,
        newCategory: normalizedCategory,
        newIsCollaborative: payload.isCollaborative ?? false,
        uploadedByDisplayName: payload.uploadedByDisplayName ?? null,
      });
    }
  };

  handleConnected = () => {
    const { refreshFileList } = this.context;
    void refreshFileList();
  };

  handleVersionRestored = () => {
    const { refreshFileList } = this.context;
    this.context.notifications.info(
      'Document was restored to a previous version. Reconnecting…',
    );
    void refreshFileList();
  };

  handleAwarenessUsersChange = (
    users: AwarenessPresenceUser[],
    activeFileId: string,
  ) => {
    const { setAwarenessUsers, filesById, setEditingUsersByPath } = this.context;
    setAwarenessUsers(users);
    const filename = (filesById.get(activeFileId)?.filename ?? '').trim();
    if (!filename) {
      setEditingUsersByPath({});
      return;
    }
    setEditingUsersByPath({ [filename]: users });
  };

  handlePermissionDenied = (message: string) => {
    const { setRuntimeRole, setStatusState } = this.context;
    setRuntimeRole('viewer');
    setStatusState('Read-only mode', 'error');
    const normalizedMessage =
      message.trim() || 'You do not have edit access to this document.';
    this.context.notifications.error(normalizedMessage);
  };

  handleAccessRevoked = () => {
    const { setRuntimeRole, setStatusState } = this.context;
    setRuntimeRole('viewer');
    setStatusState('Access revoked', 'error');
    this.context.notifications.error(
      'Your access to this document has been revoked.',
    );
  };

  handleConnectionLost = () => {
    const { setRuntimeRole, setStatusState } = this.context;
    setRuntimeRole('viewer');
    setStatusState('Connection lost', 'error');
    this.context.notifications.error(
      'Connection lost. If you joined via an anonymous link, click the link again to rejoin.',
    );
  };
}
