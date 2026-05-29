import {putApiDocumentsByIdStateMutation} from '@/client/@tanstack/react-query.gen';
import {getApiDocumentsByIdExport, putApiDocumentsByIdState} from '@/client/sdk.gen';
import {createEditorService} from '@/lib/editorService';
import {detectRequiredPackages} from '@/lib/latexPackages';
import type {EditorSetup} from '@/utils/editor';
import {getApiErrorMessage} from '@/utils/apiError';
import {
  clearErrorPanel,
  compile,
  downloadLatestPdf,
  hasCompiledPdf,
  type NamedScale,
  PdfPreviewController,
  type ScaleValue,
  showErrorMessage,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from '@/utils/preview';
import {useMutation} from '@tanstack/react-query';
import type {MutableRefObject} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import * as Y from 'yjs';
import {AUTOSAVE_DEBOUNCE_MS, DEBOUNCE_MS} from './constants';

// Errors where retrying won't help — surface to the user and stop the loop.
// 408 (timeout) and 429 (rate limit) are excluded: those can succeed on retry.
const AUTOSAVE_PERMANENT_STATUSES = new Set([400, 401, 403, 404, 413, 422]);

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.response?.status === 'number')
    return candidate.response.status;
  return null;
}

const INITIAL_PLACEHOLDER = 'Click Compile or wait 1.5 s after editing';
const EMPTY_EDITOR_PLACEHOLDER =
  'The editor is empty. Add content to render the PDF preview.';

type UseEditorCompileAutosaveArgs = {
  docId: string;
  documentTitle?: string;
  hasApiDocumentId: boolean;
  canEdit: boolean;
  editorSetupRef: MutableRefObject<EditorSetup | null>;
  setStatusState: (text: string, cls: string) => void;
  onAddPackage?: (packageName: string) => void;
};

export function useEditorCompileAutosave({
  docId,
  documentTitle,
  hasApiDocumentId,
  canEdit,
  editorSetupRef,
  setStatusState,
  onAddPackage,
}: UseEditorCompileAutosaveArgs) {
  const [canExportPdf, setCanExportPdf] = useState<boolean>(false);
  const [isCompilingOn, setIsCompilingOn] = useState<boolean>(true);
  const [autosaveStatus, setAutosaveStatus] =
    useState<string>('All changes saved');
  const [placeholderMessage, setPlaceholderMessage] = useState<string | null>(
    INITIAL_PLACEHOLDER,
  );
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [zoomMode, setZoomMode] = useState<NamedScale | null>('page-width');

  // The DOM elements the PDFViewer needs. We hold them in state (not refs)
  // so the controller-creation effect runs once both are populated.
  const [pdfContainerEl, setPdfContainerEl] =
    useState<HTMLDivElement | null>(null);
  const [pdfViewerEl, setPdfViewerEl] = useState<HTMLDivElement | null>(null);
  const errorPanelRef = useRef<HTMLElement | null>(null);
  const controllerRef = useRef<PdfPreviewController | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef<boolean>(false);
  const autosaveDirtyRef = useRef<boolean>(false);
  const compileAfterAutosaveRef = useRef<boolean>(false);
  const manualCompileAfterAutosaveRef = useRef<boolean>(false);
  const scheduleAutosaveRef = useRef<() => void>(() => undefined);
  const triggerCompileRef = useRef<() => Promise<void>>(async () => undefined);

  const hasRenderableContent = useCallback(() => {
    const content = editorSetupRef.current?.editor.getValue() ?? '';
    return content.trim().length > 0;
  }, [editorSetupRef]);

  // Create / tear down the PDFViewer-backed controller as soon as its two
  // host elements are mounted. Also subscribe to scale-change events so the
  // zoom dropdown stays in sync (e.g. Ctrl+wheel zoom inside the viewer, or
  // fit-mode resizing).
  useEffect(() => {
    if (!pdfContainerEl || !pdfViewerEl) return undefined;
    const controller = new PdfPreviewController(pdfContainerEl, pdfViewerEl);
    controllerRef.current = controller;
    const unsubscribe = controller.onScaleChange((scale, mode) => {
      setZoomScale(scale);
      setZoomMode(mode);
    });
    return () => {
      unsubscribe();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [pdfContainerEl, pdfViewerEl]);

  // Keep fit-modes correct when the preview panel is resized (e.g. user
  // drags the splitter). Throttled via requestAnimationFrame inside the
  // controller's refreshFit.
  useEffect(() => {
    if (!pdfContainerEl) return undefined;
    const observer = new ResizeObserver(() => {
      controllerRef.current?.refreshFit();
    });
    observer.observe(pdfContainerEl);
    return () => observer.disconnect();
  }, [pdfContainerEl]);

  const isCompilingOnRef = useRef(isCompilingOn);
  useEffect(() => {
    isCompilingOnRef.current = isCompilingOn;
  }, [isCompilingOn]);

  const ensureRequiredPackages = useCallback(() => {
    const editor = editorSetupRef.current?.editor;
    if (!editor) {
      return false;
    }

    const service = createEditorService(editor);
    const source = service.getValue();
    const requiredPackages = detectRequiredPackages(source);
    if (requiredPackages.length === 0) {
      return false;
    }

    return service.ensureLatexPackages(requiredPackages);
  }, [editorSetupRef]);

  const autosaveMutation = useMutation({
    ...putApiDocumentsByIdStateMutation(),
    mutationFn: async (options: any) => {
      const ydoc = editorSetupRef.current?.ydoc;
      if (!ydoc) return;

      const state = Y.encodeStateAsUpdate(ydoc);
      const normalizedState = Uint8Array.from(state);
      const stateBlob = new Blob([normalizedState], {
        type: 'application/octet-stream',
      });

      await putApiDocumentsByIdState({
        ...options,
        bodySerializer: null,
        headers: {
          'Content-Type': 'application/octet-stream',
          ...options.headers,
        },
        body: stateBlob,
        throwOnError: true,
      } as any);
    },
  });

  const autosaveMutateAsyncRef = useRef(autosaveMutation.mutateAsync);
  useEffect(() => {
    autosaveMutateAsyncRef.current = autosaveMutation.mutateAsync;
  }, [autosaveMutation.mutateAsync]);

  const runCompile = useCallback(async () => {
    const errorPanel = errorPanelRef.current;
    if (!editorSetupRef.current || !errorPanel) return;

    const insertedPackage = ensureRequiredPackages();
    if (insertedPackage) {
      compileAfterAutosaveRef.current = true;
      if (hasApiDocumentId && canEdit) {
        scheduleAutosaveRef.current();
      }
      return;
    }

    if (!hasRenderableContent()) {
      compileAfterAutosaveRef.current = false;
      setCanExportPdf(false);
      controllerRef.current?.clear();
      clearErrorPanel(errorPanel);
      setPlaceholderMessage(EMPTY_EDITOR_PLACEHOLDER);
      setStatusState('Waiting for content', '');
      return;
    }

    if (!hasApiDocumentId) {
      setStatusState('Compile unavailable', 'error');
      return;
    }

    await compile(controllerRef.current, {
      docId,
      onStatus: setStatusState,
      onError: (message) => {
        controllerRef.current?.clear();
        setPlaceholderMessage(null);
        showErrorMessage(errorPanel, message);
      },
    });

    const compiled = hasCompiledPdf();
    setCanExportPdf(compiled);
    if (compiled) {
      clearErrorPanel(errorPanel);
      setPlaceholderMessage(null);
    }
  }, [
    docId,
    editorSetupRef,
    canEdit,
    hasApiDocumentId,
    hasRenderableContent,
    ensureRequiredPackages,
    setStatusState,
  ]);

  const triggerCompile = useCallback(async () => {
    if (!isCompilingOnRef.current) {
      return;
    }
    await runCompile();
  }, [runCompile]);

  const persistAutosave = useCallback(async () => {
    if (!hasApiDocumentId || !editorSetupRef.current?.ydoc || !canEdit) {
      return;
    }

    if (autosaveInFlightRef.current) {
      autosaveDirtyRef.current = true;
      return;
    }

    autosaveInFlightRef.current = true;
    autosaveDirtyRef.current = false;
    setAutosaveStatus('Saving...');

    try {
      await autosaveMutateAsyncRef.current({
        path: { id: docId },
      });

      const savedAt = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      setAutosaveStatus(`Saved at ${savedAt}`);

      const shouldCompileNow =
        !autosaveDirtyRef.current &&
        ((compileAfterAutosaveRef.current && isCompilingOnRef.current) ||
          manualCompileAfterAutosaveRef.current);

      if (shouldCompileNow) {
        compileAfterAutosaveRef.current = false;
        manualCompileAfterAutosaveRef.current = false;
        void runCompile();
      }
    } catch (err) {
      // Distinguish permanent (4xx) from transient (network/5xx) failures.
      // Permanent failures should stop the retry loop and surface a toast —
      // otherwise the user sees "Retrying..." forever on a doc >5MB or
      // after their session expired.
      const status = getErrorStatus(err);
      const isPermanent = status !== null && AUTOSAVE_PERMANENT_STATUSES.has(status);
      const message = getApiErrorMessage(err) ?? 'Autosave failed.';
      if (isPermanent) {
        setAutosaveStatus(`Not saved — ${message}`);
        toast.error(`Autosave failed: ${message}`);
        autosaveDirtyRef.current = false;
      } else {
        setAutosaveStatus('Autosave failed. Retrying...');
        autosaveDirtyRef.current = true;
      }
    } finally {
      autosaveInFlightRef.current = false;

      if (autosaveDirtyRef.current) {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(
          () => void persistAutosave(),
          AUTOSAVE_DEBOUNCE_MS,
        );
      }
    }
  }, [canEdit, docId, editorSetupRef, hasApiDocumentId, runCompile]);

  const scheduleAutosave = useCallback(() => {
    if (!hasApiDocumentId || !canEdit) return;

    autosaveDirtyRef.current = true;
    setAutosaveStatus('Unsaved changes');

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(
      () => void persistAutosave(),
      AUTOSAVE_DEBOUNCE_MS,
    );
  }, [canEdit, hasApiDocumentId, persistAutosave]);

  useEffect(() => {
    scheduleAutosaveRef.current = scheduleAutosave;
  }, [scheduleAutosave]);

  const scheduleCompile = useCallback(() => {
    if (!hasRenderableContent()) {
      compileAfterAutosaveRef.current = false;
      setCanExportPdf(false);
      controllerRef.current?.clear();
      const errorPanel = errorPanelRef.current;
      if (errorPanel) clearErrorPanel(errorPanel);
      setPlaceholderMessage(EMPTY_EDITOR_PLACEHOLDER);

      if (hasApiDocumentId && canEdit) {
        scheduleAutosave();
      }
      return;
    }

    if (hasApiDocumentId && canEdit) {
      if (isCompilingOnRef.current) {
        compileAfterAutosaveRef.current = true;
      }
      scheduleAutosave();
      return;
    }

    if (!isCompilingOnRef.current) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void triggerCompile();
    }, DEBOUNCE_MS);
  }, [
    canEdit,
    hasApiDocumentId,
    hasRenderableContent,
    scheduleAutosave,
    triggerCompile,
  ]);

  useEffect(() => {
    triggerCompileRef.current = triggerCompile;
  }, [triggerCompile]);

  const handleToggleCompiling = useCallback(() => {
    setIsCompilingOn((prev) => {
      const next = !prev;
      if (!next) {
        compileAfterAutosaveRef.current = false;
      }
      return next;
    });
  }, []);

  const handleCompile = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (hasApiDocumentId && canEdit && editorSetupRef.current?.ydoc) {
      manualCompileAfterAutosaveRef.current = true;
      void persistAutosave();
      return;
    }
    void runCompile();
  }, [canEdit, editorSetupRef, hasApiDocumentId, persistAutosave, runCompile]);

  const handleExportPdf = useCallback(() => {
    const baseName = (documentTitle || docId).trim();
    const safeName =
      baseName === '' ? 'main' : baseName.replace(/[^a-zA-Z0-9-_]+/g, '-');
    downloadLatestPdf(`${safeName}.pdf`);
  }, [docId, documentTitle]);

  // Bundle the entire project (collab + static files) into a zip via the
  // backend, then trigger a download. The server live-extracts the current
  // Y.Doc state so unsaved keystrokes are included in the export.
  const handleExportProject = useCallback(async () => {
    if (!hasApiDocumentId) return;
    try {
      const { data } = await getApiDocumentsByIdExport({
        path: { id: docId },
        parseAs: 'blob',
        throwOnError: true,
      });
      if (!(data instanceof Blob)) return;
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      const baseName = (documentTitle || docId).trim();
      const safeName =
        baseName === '' ? 'project' : baseName.replace(/[^a-zA-Z0-9-_]+/g, '-');
      link.href = url;
      link.download = `${safeName}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      const message =
        getApiErrorMessage(err) ?? 'Could not export this project.';
      toast.error(message);
    }
  }, [docId, documentTitle, hasApiDocumentId]);

  const handleSelectZoom = useCallback((value: ScaleValue) => {
    controllerRef.current?.setScale(value);
  }, []);

  const handleZoomIn = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const next = Math.min(ZOOM_MAX, controller.getScale() * ZOOM_STEP);
    controller.setScale(next);
  }, []);

  const handleZoomOut = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const next = Math.max(ZOOM_MIN, controller.getScale() / ZOOM_STEP);
    controller.setScale(next);
  }, []);

  const handlePdfContainerReady = useCallback((container: HTMLDivElement) => {
    setPdfContainerEl(container);
  }, []);

  const handlePdfViewerReady = useCallback((viewer: HTMLDivElement) => {
    setPdfViewerEl(viewer);
  }, []);

  const handleErrorPanelReady = useCallback((panel: HTMLElement) => {
    errorPanelRef.current = panel;
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  // Mark onAddPackage as intentionally unused — kept in the args for API
  // compatibility with the coordinator. The previous compile() accepted it
  // too without ever invoking it.
  void onAddPackage;

  return {
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
  };
}
