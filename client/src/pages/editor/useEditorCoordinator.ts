import {createEditorService} from '@/lib/editorService';
import type {DetectedFormula} from '@/snippets/formula/formulaUtils';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';
import {type AuthResponse, type FileResponse, getApiDocumentsByIdFiles, postApiDocumentsByIdFiles} from '@/client';
import {getApiDocumentsByIdFilesOptions, getApiDocumentsByIdFilesQueryKey} from '@/client/@tanstack/react-query.gen.ts';
import type {DocumentSettings} from '@/components/DocumentSettingsDialog.tsx';
import type {AwarenessPresenceUser, AwarenessUser, EditorSetup} from '@/utils/editor.ts';
import {getDocId} from '@/utils/editor.ts';
import {GUID_PATTERN} from './constants';
import {createHandleApplyDocumentSettings} from './documentSettings';
import {
  MAIN_TAB_KEY,
  isPreviewableImageFile,
} from './fileEditorUtils';
import type * as monaco from 'monaco-editor';
import {useEditorCompileAutosave} from './useEditorCompileAutosave';
import type {DocumentRole} from './useEditorDocument';
import {useEditorDocument} from './useEditorDocument';
import {useEditorFileTabs} from './useEditorFileTabs';
import {useEditorSelectionOverlay} from './useEditorSelectionOverlay';
import {
  isCategoryDownloadOnly,
  isCategoryPreviewPdf,
  isCollaborativeCategory,
} from '@/utils/fileCategories';
import {EditorSession, type ReplaceBannerState} from './editorSession';
import { createNotificationAdapter, createDocumentFilesAdapter, createEditorAdapter, createCollaborationAdapter } from './adapters';

type UseEditorCoordinatorArgs = {
  user: AuthResponse | null;
};

export function useEditorCoordinator({ user }: UseEditorCoordinatorArgs) {
  const docId = getDocId();
  const hasApiDocumentId = GUID_PATTERN.test(docId);
  const queryClient = useQueryClient();
  const fileListQueryKey = getApiDocumentsByIdFilesQueryKey({
    path: { id: docId },
  });
  const [status, setStatus] = useState<string>('Connecting…');
  const [statusClass, setStatusClass] = useState<string>('');
  const [awarenessUsers, setAwarenessUsers] = useState<AwarenessPresenceUser[]>(
    [],
  );
  const [editingUsersByPath, setEditingUsersByPath] = useState<
    Record<string, AwarenessPresenceUser[]>
  >({});
  const [replaceBanner, setReplaceBanner] =
    useState<ReplaceBannerState | null>(null);
  const [documentText, setDocumentText] = useState<string>('');
  const [runtimeRole, setRuntimeRole] = useState<DocumentRole | null>(null);
  const [editorSetup, setEditorSetup] = useState<EditorSetup | null>(null);
  const [isSnippetSidebarCollapsed, setIsSnippetSidebarCollapsed] =
    useState<boolean>(false);
  const [currentSettings, setCurrentSettings] = useState<DocumentSettings>({
    documentClass: 'article',
    paperSize: 'a4paper',
    margins: 'default',
    language: 'english',
    fontsize: '11pt',
    encoding: 'utf8',
  });
  const mainEditorSetupRef = useRef<EditorSetup | null>(null);
  const fileEditorSetupRef = useRef<EditorSetup | null>(null);
  const activeEditorSetupRef = useRef<EditorSetup | null>(null);
  const snippetSidebarPanelRef = useRef<any>(null);
  // Per-tab Monaco view state (cursor + selection + scroll + folding).
  // Captured in the effect cleanup below — by the time that cleanup fires,
  // LatexEditor's model-swap useEffect setup has NOT yet run (React always
  // runs all cleanups before any setups in a single commit), so the editor
  // still holds the leaving tab's model and saveViewState captures the right
  // state. Restored in the same effect's setup after the swap settles.
  const viewStateByTabKeyRef = useRef<
    Map<string, monaco.editor.ICodeEditorViewState>
  >(new Map());

  const setStatusState = useCallback((text: string, cls: string) => {
    setStatus(text);
    setStatusClass(cls);
  }, []);

  const handleAddLatexPackage = useCallback((packageName: string) => {
    const editor = mainEditorSetupRef.current?.editor;
    if (!editor) {
      return;
    }

    const normalized = packageName.trim();
    if (!normalized) {
      return;
    }

    createEditorService(editor).ensureLatexPackage(normalized);
  }, []);

  const handleSnippetSidebarToggle = useCallback(() => {
    if (isSnippetSidebarCollapsed) {
      snippetSidebarPanelRef.current?.expand?.();
      return;
    }

    snippetSidebarPanelRef.current?.collapse?.();
  }, [isSnippetSidebarCollapsed]);

  // useEditorDocument is initialized before useEditorCompileAutosave (whose
  // triggerCompile we want to fire on entrypoint change). Bridge the two with a
  // ref: the document hook calls `() => triggerCompileRef.current?.()`, and
  // we assign the real triggerCompile to that ref a few lines below.
  const triggerCompileForEntrypointRef = useRef<(() => void) | null>(null);
  const {
    documentQuery,
    initialYjsState,
    isLoadingInitialState,
    documentTitle,
    documentRole,
    accessorDisplayName,
    documentTitleInput,
    setDocumentTitleInput,
    renameError,
    renameDocumentMutation,
    handleRenameDocument,
    handleSetEntrypoint,
  } = useEditorDocument({
    docId,
    hasApiDocumentId,
    onEntrypointChanged: () => triggerCompileForEntrypointRef.current?.(),
  });

  const filesQuery = useQuery({
    ...getApiDocumentsByIdFilesOptions({
      path: { id: docId },
    }),
    enabled: hasApiDocumentId,
  });
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const entrypointFilename =
    (documentQuery.data?.entrypoint ?? 'main.tex').trim() || 'main.tex';
  const entrypointFile = useMemo(
    () =>
      files.find(
        (file) =>
          (file.filename ?? '').trim() === entrypointFilename &&
          file.isCollaborative,
      ),
    [entrypointFilename, files],
  );
  const entrypointFileId = (entrypointFile?.id ?? '').trim() || null;
  const isEntrypointMissing =
    hasApiDocumentId && filesQuery.isSuccess && !entrypointFileId;
  const filesById = useMemo(
    () =>
      new Map(
        files
          .filter((file) => file.id && file.filename)
          .map((file) => [file.id as string, file]),
      ),
    [files],
  );
  const refreshFileList = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: fileListQueryKey });
  }, [fileListQueryKey, queryClient]);
  const updateFileListCache = useCallback(
    (updater: (files: FileResponse[]) => FileResponse[]) => {
      queryClient.setQueryData(fileListQueryKey, (previous) => {
        const current = Array.isArray(previous) ? previous : [];
        return updater(current);
      });
    },
    [fileListQueryKey, queryClient],
  );

  useEffect(() => {
    setRuntimeRole(documentRole);
  }, [documentRole]);

  const effectiveRole = runtimeRole ?? documentRole;
  const isOwner = effectiveRole === 'owner';
  const isViewer = effectiveRole === 'viewer';
  const canEditFiles = !isViewer;
  const {
    openFileTabs,
    activeEditorTabKey,
    setActiveEditorTabKey,
    isOpeningFile,
    activeFileTab,
    isMainTabActive,
    handleFileDocChange,
    handleOpenFile: handleOpenFileTab,
    handleCloseFileTab,
    closeFileTabById,
    updateFileTabById,
    refreshStaticTextTab,
  } = useEditorFileTabs({
    docId,
    hasApiDocumentId,
  });

  const activeFileCategory = activeFileTab?.category ?? null;
  const isActiveFileCollaborative = activeFileTab
    ? isCollaborativeCategory(activeFileTab.category, activeFileTab.isCollaborative)
    : false;
  const isActiveCollaborativeTab = isMainTabActive || isActiveFileCollaborative;
  const activeCollaborativeFileId = isMainTabActive
    ? entrypointFileId
    : isActiveFileCollaborative
      ? activeFileTab?.fileId ?? null
      : null;

  const {
    canExportPdf,
    autosaveStatus,
    isCompilingOn,
    placeholderMessage,
    zoomScale,
    zoomMode,
    triggerCompile,
    scheduleCompile,
    handleCompile,
    handleToggleCompiling,
    handleExportPdf,
    handleExportProject,
    handleSelectZoom,
    handleZoomIn,
    handleZoomOut,
    handlePdfContainerReady,
    handlePdfViewerReady,
    handleErrorPanelReady,
  } = useEditorCompileAutosave({
    docId,
    documentTitle,
    hasApiDocumentId,
    canEdit: !isViewer,
    editorSetupRef: mainEditorSetupRef,
    setStatusState,
    onAddPackage: handleAddLatexPackage,
  });

  // Close the bridge: now that triggerCompile exists, point the ref at it so
  // useEditorDocument's onEntrypointChanged callback can reach it.
  triggerCompileForEntrypointRef.current = () => {
    void triggerCompile();
  };

  const isAnonymousSession = !user;

  const {
    selectedText,
    selectionOverlay,
    formulaOverlay,
    isInTable,
    handleSelectionChange,
    handleAddTableRow,
  } = useEditorSelectionOverlay({ editorSetupRef: activeEditorSetupRef });
  const [isFormulaDialogOpen, setIsFormulaDialogOpen] = useState(false);
  const [activeFormula, setActiveFormula] = useState<DetectedFormula | null>(
    null,
  );
  const activeFormulaRef = useRef<DetectedFormula | null>(null);

  const awarenessUser = useMemo<AwarenessUser | undefined>(() => {
    if (!user) {
      const anonymousDisplayName = accessorDisplayName?.trim();
      if (!anonymousDisplayName) {
        return undefined;
      }

      return {
        displayName: anonymousDisplayName,
      };
    }

    return {
      id: user.id ?? null,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
    };
  }, [accessorDisplayName, user]);

  const currentUserDisplayName = useMemo(() => {
    const displayName = awarenessUser?.displayName?.trim();
    if (displayName) {
      return displayName;
    }
    const email = awarenessUser?.email?.trim();
    if (email) {
      return email;
    }
    return null;
  }, [awarenessUser]);

  const avatarUsers = useMemo(() => {
    const seenNames = new Set<string>();

    return awarenessUsers.reduce<
      Array<{ id: string; name: string; color: string }>
    >((uniqueUsers, { clientId, name, color }) => {
      const normalizedName = name.trim().toLocaleLowerCase();
      if (seenNames.has(normalizedName)) {
        return uniqueUsers;
      }

      seenNames.add(normalizedName);
      uniqueUsers.push({
        id: String(clientId),
        name,
        color,
      });

      return uniqueUsers;
    }, []);
  }, [awarenessUsers]);

  const sessionRef = useRef<EditorSession | null>(null);

  const notifications = createNotificationAdapter();
  const documentFiles = createDocumentFilesAdapter();
  const editorAdapter = createEditorAdapter();
  const collaborationAdapter = createCollaborationAdapter();


  const sessionContext = {
    docId,
    hasApiDocumentId,
    entrypointFileId,
    activeCollaborativeFileId,
    isActiveCollaborativeTab,
    isMainTabActive,
    activeFileCategory,
    activeFileTab,
    currentUserDisplayName,
    filesById,
    replaceBanner,
    isViewer,
    mainEditorSetupRef,
    fileEditorSetupRef,
    activeEditorSetupRef,
    setEditorSetup,
    setDocumentText,
    setCurrentSettings,
    scheduleCompile,
    triggerCompile,
    setActiveEditorTabKey,
    handleOpenFileTab,
    closeFileTabById,
    updateFileTabById,
    refreshStaticTextTab,
    refreshFileList,
    updateFileListCache,
    setReplaceBanner,
    setAwarenessUsers,
    setEditingUsersByPath,
    setRuntimeRole,
    setStatusState,
    notifications,
    documentFiles,
    editorAdapter,
    collaborationAdapter,
    formulaOverlay,
    activeFormulaRef,
    setActiveFormula,
    setIsFormulaDialogOpen,
  };

  if (!sessionRef.current) {
    sessionRef.current = new EditorSession(sessionContext);
  } else {
    sessionRef.current.update(sessionContext);
  }

  const editorSession = sessionRef.current!;
  const handleEditorReady = editorSession.handleEditorReady;
  const handleFileEditorReady = editorSession.handleFileEditorReady;
  const handleDocChange = editorSession.handleDocChange;
  const handleSnippetInsert = editorSession.handleSnippetInsert;
  const handleOpenFormulaDialog = editorSession.handleOpenFormulaDialog;
  const handleSaveFormula = editorSession.handleSaveFormula;
  const handleFormulaDialogChange = editorSession.handleFormulaDialogChange;
  const handleSnippetDrop = editorSession.handleSnippetDrop;
  const handleFileDrop = editorSession.handleFileDrop;
  const handleApplyVersion = editorSession.handleApplyVersion;
  const handleInsertBasicTemplate = editorSession.handleInsertBasicTemplate;
  const handleWrapSelection = editorSession.handleWrapSelection;
  const handleUnwrapSelection = editorSession.handleUnwrapSelection;
  const handleOpenFile = editorSession.handleOpenFile;
  const handleOpenReplacedFile = editorSession.handleOpenReplacedFile;
  const handleCloseReplaceBanner = editorSession.handleCloseReplaceBanner;
  const handleFileEvent = editorSession.handleFileEvent;
  const handleConnected = editorSession.handleConnected;
  const handleVersionRestored = editorSession.handleVersionRestored;
  const handleAwarenessUsersChange = editorSession.handleAwarenessUsersChange;
  const handlePermissionDenied = editorSession.handlePermissionDenied;
  const handleAccessRevoked = editorSession.handleAccessRevoked;
  const handleConnectionLost = editorSession.handleConnectionLost;

  const handleApplyDocumentSettings = useMemo(
    () =>
      createHandleApplyDocumentSettings({
        editorSetupRef: mainEditorSetupRef,
        scheduleCompile,
        setCurrentSettings,
        setDocumentText,
      }),
    [scheduleCompile],
  );

  useEffect(() => {
    return () => {
      const mainSetup = mainEditorSetupRef.current;
      const activeSetup = activeEditorSetupRef.current;
      mainSetup?.cleanup?.();
      if (activeSetup && activeSetup !== mainSetup) {
        activeSetup.cleanup?.();
      }
    };
  }, []);

  // Auto-compile once on first load when both the editor is bound AND the
  // entrypoint file is known AND the editor actually has content. This catches
  // the race where the initial Y-Monaco sync fires onDocChange BEFORE filesQuery
  // resolves — handleDocChange bails on the entrypointFileId guard, and without
  // this effect the doc would never compile until the user typed something.
  const hasAutoCompiledForDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (hasAutoCompiledForDocRef.current === docId) return;
    if (!editorSetup || !entrypointFileId) return;
    if (!isMainTabActive) return;

    // Defer a tick to give the Y-Monaco binding time to push the initial
    // state into Monaco. If the editor is still empty after the wait,
    // assume it's a genuinely blank doc and skip — the next handleDocChange
    // (when content arrives) will schedule a compile through the normal path.
    const timer = setTimeout(() => {
      if (hasAutoCompiledForDocRef.current === docId) return;
      const text = editorSetup.editor.getValue?.() ?? '';
      if (!text.trim()) return;
      hasAutoCompiledForDocRef.current = docId;
      void triggerCompile();
    }, 250);
    return () => clearTimeout(timer);
  }, [docId, editorSetup, entrypointFileId, isMainTabActive, triggerCompile]);

  useEffect(() => {
    activeEditorSetupRef.current = isActiveCollaborativeTab
      ? mainEditorSetupRef.current
      : fileEditorSetupRef.current;
  }, [isActiveCollaborativeTab]);

  useEffect(() => {
    // Tab key alone doesn't say which physical editor is showing this tab —
    // a non-entrypoint *collaborative* file lives in the main editor (its
    // model swaps via setActiveFileId), while a non-collab text file lives
    // in the separately-mounted file editor. Pick the ref accordingly.
    const isCollabSlot =
      activeEditorTabKey === MAIN_TAB_KEY ||
      Boolean(activeFileTab?.isCollaborative);
    const editor = isCollabSlot
      ? mainEditorSetupRef.current
      : fileEditorSetupRef.current;

    // SETUP: restore the arriving tab's saved view state, if any. By the time
    // this runs LatexEditor's setActiveFileId effect has already swapped the
    // Monaco model (child effects fire before parent effects), so the fresh
    // model is in place to receive the restore.
    const saved = viewStateByTabKeyRef.current.get(activeEditorTabKey);
    if (saved && editor?.restoreViewState) {
      editor.restoreViewState(saved);
    }

    // CLEANUP: save the leaving tab's view state. React fires all cleanups
    // for the next render BEFORE any setups, so when this runs on the next
    // tab switch, LatexEditor hasn't yet disposed/replaced its model — the
    // saveViewState call captures the leaving tab's real cursor + scroll.
    return () => {
      if (!editor?.saveViewState) return;
      const state = editor.saveViewState();
      if (state) {
        viewStateByTabKeyRef.current.set(activeEditorTabKey, state);
      }
    };
    // Deps: tab key (the obvious trigger) + isCollaborative (so toggling
    // a tab between collab/non-collab states re-picks the right editor ref).
  }, [activeEditorTabKey, activeFileTab?.isCollaborative]);

  const activeFilePath = activeFileTab?.filename ?? null;
  const activeFilePreviewUrl = activeFileTab
    ? `/api/documents/${docId}/files/${activeFileTab.fileId}`
    : null;
  const canPreviewActiveFileImage = Boolean(
    activeFileTab &&
    !activeFileTab.isTextEditable &&
    isPreviewableImageFile({
      filename: activeFileTab.filename,
      contentType: activeFileTab.contentType,
    }),
  );
  const mainEntrypointPath =
    (documentQuery.data?.entrypoint ?? 'main.tex').trim() || 'main.tex';
  const canPreviewActiveFilePdf =
    activeFileTab && isCategoryPreviewPdf(activeFileTab.category);
  const isDownloadOnlyFile =
    activeFileTab && isCategoryDownloadOnly(activeFileTab.category);
  const sidebarActiveFilePath = isMainTabActive
    ? entrypointFilename
    : activeFilePath;
  const sidebarEditingUsersByPath = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(editingUsersByPath).map(([path, users]) => [
          path,
          users.map((presenceUser) => ({
            id: String(presenceUser.clientId),
            name: presenceUser.name,
            color: presenceUser.color,
          })),
        ]),
      ),
    [editingUsersByPath],
  );

  return {
    activeFilePreviewUrl,
    activeFileTab,
    activeFormula,
    activeEditorTabKey,
    autosaveStatus,
    avatarUsers,
    canEditFiles,
    canExportPdf,
    canPreviewActiveFileImage,
    canPreviewActiveFilePdf,
    currentSettings,
    docId,
    editorSetup,
    documentQuery,
    documentText,
    documentTitle,
    documentTitleInput,
    entrypointFileId,
    effectiveRole,
    formulaOverlay,
    awarenessUser,
    handleAccessRevoked,
    handleAddTableRow,
    handleApplyDocumentSettings,
    handleApplyVersion,
    handleCloseFileTab,
    handleConnectionLost,
    handleDocChange,
    handleEditorReady,
    handleConnected,
    handleErrorPanelReady,
    handleExportPdf,
    handleExportProject,
    handleCompile,
    handleFileDocChange,
    handleFileEvent,
    handleFileDrop,
    handleFileEditorReady,
    handleFormulaDialogChange,
    handleInsertBasicTemplate,
    handleOpenFile,
    handleOpenReplacedFile,
    handleOpenFormulaDialog,
    handlePdfContainerReady,
    handlePdfViewerReady,
    handlePermissionDenied,
    handleRenameDocument,
    handleSetEntrypoint,
    handleSaveFormula,
    handleSelectionChange,
    handleSnippetDrop,
    handleSnippetInsert,
    handleSnippetSidebarToggle,
    handleToggleCompiling,
    handleUnwrapSelection,
    handleWrapSelection,
    handleSelectZoom,
    handleZoomIn,
    handleZoomOut,
    handleVersionRestored,
    handleAwarenessUsersChange,
    hasApiDocumentId,
    initialYjsState,
    isAnonymousSession,
    isCompilingOn,
    isFormulaDialogOpen,
    isInTable,
    isLoadingInitialState,
    isDownloadOnlyFile,
    isEntrypointMissing,
    isMainTabActive,
    isOpeningFile,
    isOwner,
    isSnippetSidebarCollapsed,
    isViewer,
    openFileTabs,
    placeholderMessage,
    zoomScale,
    zoomMode,
    renameDocumentMutation,
    renameError,
    replaceBanner,
    selectedText,
    selectionOverlay,
    setActiveEditorTabKey,
    setDocumentTitleInput,
    setIsSnippetSidebarCollapsed,
    setStatusState,
    sidebarActiveFilePath,
    sidebarEditingUsersByPath,
    snippetSidebarPanelRef,
    status,
    statusClass,
    handleCloseReplaceBanner,
  };
}
