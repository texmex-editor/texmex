import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import { postApiDocumentsByIdCompile } from '@/client';
import { getApiErrorMessage } from '@/utils/apiError';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

// Standard fonts + cmaps are copied to these public paths by the
// viteStaticCopy plugin (see vite.config.ts). Without them PDF.js falls back
// to system fonts whose metrics misalign the text layer — selection
// rectangles end up between lines instead of on them.
const STANDARD_FONT_DATA_URL = '/pdfjs-standard-fonts/';
const CMAP_URL = '/pdfjs-cmaps/';

// Named scale modes accepted by PDFViewer.currentScaleValue.
// Numeric scales (e.g. "1.5") are also valid — keep them as strings on the wire.
export type NamedScale =
  | 'page-actual'
  | 'page-width'
  | 'page-height'
  | 'page-fit'
  | 'auto';

export type ScaleValue = number | NamedScale;

export const DEFAULT_SCALE: NamedScale = 'page-width';
// Overleaf uses 1.25× per zoom step. Clamps match PDFViewer's MIN/MAX_SCALE.
export const ZOOM_STEP = 1.25;
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 10;
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2, 4] as const;

export type CompileOptions = {
  docId: string;
  onStatus: (status: string, cls: string) => void;
  onError: (message: string) => void;
};

type LatestPdfState = {
  bytes: Uint8Array | null;
  blob: Blob | null;
};

const latest: LatestPdfState = { bytes: null, blob: null };
let compileInFlight = false;

/**
 * Owns the Mozilla PDFViewer instance. Built once per editor mount and torn
 * down on unmount. All canvas rendering, text/annotation layers, scroll, and
 * fit-mode math live inside PDFViewer — we don't try to do any of it here.
 */
export class PdfPreviewController {
  private readonly container: HTMLDivElement;
  private readonly eventBus: EventBus;
  private readonly linkService: PDFLinkService;
  private readonly viewer: PDFViewer;
  private currentDoc: pdfjs.PDFDocumentProxy | null = null;
  private scaleListeners = new Set<
    (scale: number, mode: NamedScale | null) => void
  >();
  // Captured before each re-load so the recompile flow can put the user back
  // where they were. Null on the very first load (no prior state to keep).
  private pendingRestore:
    | { scrollTop: number; pageNumber: number; scaleValue: string }
    | null = null;

  constructor(container: HTMLDivElement, viewer: HTMLDivElement) {
    this.container = container;
    this.eventBus = new EventBus();
    this.linkService = new PDFLinkService({ eventBus: this.eventBus });
    this.viewer = new PDFViewer({
      container,
      viewer,
      eventBus: this.eventBus,
      linkService: this.linkService,
      // Default is 4096*4096 — too low for A4 at high DPR + 200%+ zoom. Raise
      // it so PDFViewer doesn't silently downsample. Match Overleaf; Safari
      // needs the smaller cap.
      maxCanvasPixels: isSafari() ? 4096 * 4096 : 8192 * 8192,
      // Borders shift the canvas relative to the text layer's coordinate
      // origin, causing selection rectangles to land below the visible text.
      // Drop them; we can paint our own border in CSS if we want one.
      removePageBorders: true,
    });
    this.linkService.setViewer(this.viewer);

    this.eventBus.on('pagesinit', () => {
      // On the first load, apply the project default scale. On re-loads
      // (recompiles) put the user back at the page + scroll + zoom they had
      // before — otherwise a recompile jumps them to page 1 mid-edit.
      if (this.pendingRestore) {
        const restore = this.pendingRestore;
        this.pendingRestore = null;
        // Preserve the user's chosen scale (could be numeric like "1.25" or
        // a named mode like "page-width"). Fall back to the default if we
        // somehow captured an empty value.
        this.viewer.currentScaleValue = restore.scaleValue || DEFAULT_SCALE;
        // Snap to the same page, clamping if the new doc is shorter.
        const clampedPage = Math.max(
          1,
          Math.min(restore.pageNumber, this.viewer.pagesCount || 1),
        );
        this.viewer.currentPageNumber = clampedPage;
        // Fine-tune scroll AFTER PDF.js has laid out the pages at the new
        // scale; rAF gives it one frame to compute heights.
        requestAnimationFrame(() => {
          this.container.scrollTop = Math.min(
            restore.scrollTop,
            this.container.scrollHeight,
          );
        });
      } else {
        this.viewer.currentScaleValue = DEFAULT_SCALE;
      }
      this.emitScale();
    });
    this.eventBus.on('scalechanging', () => this.emitScale());
  }

  async loadPdf(bytes: Uint8Array): Promise<void> {
    // Capture view state BEFORE setDocument so the pagesinit handler can
    // restore it on the new document. Skipped on the first load (currentDoc
    // is still null — there's nothing to restore from).
    if (this.currentDoc) {
      this.pendingRestore = {
        scrollTop: this.container.scrollTop,
        pageNumber: this.viewer.currentPageNumber,
        scaleValue: String(this.viewer.currentScaleValue || ''),
      };
    }

    // PDF.js may transfer ownership of the buffer to its worker; always copy.
    const loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
    });
    const doc = await loadingTask.promise;
    this.currentDoc?.destroy();
    this.currentDoc = doc;
    this.viewer.setDocument(doc);
    this.linkService.setDocument(doc, null);
  }

  /** Drop the currently loaded PDF so the viewer is empty (placeholder takes over). */
  clear(): void {
    try {
      // PDFViewer.setDocument accepts null at runtime to clear the viewer
      // (its TS types are stricter than the runtime contract).
      this.viewer.setDocument(null as unknown as pdfjs.PDFDocumentProxy);
    } catch {
      // setDocument(null) throws on first call before any document — safe.
    }
    this.currentDoc?.destroy();
    this.currentDoc = null;
  }

  setScale(value: ScaleValue): void {
    this.viewer.currentScaleValue = String(value);
  }

  /** Numeric scale currently displayed (1 = 100%). */
  getScale(): number {
    return this.viewer.currentScale || 1;
  }

  /** Named mode if the active scale is one (e.g. "page-width"), else null. */
  getScaleMode(): NamedScale | null {
    const raw = this.viewer.currentScaleValue;
    if (
      raw === 'page-actual' ||
      raw === 'page-width' ||
      raw === 'page-height' ||
      raw === 'page-fit' ||
      raw === 'auto'
    ) {
      return raw;
    }
    return null;
  }

  /** Re-apply named scale on container resize. No-op for numeric scales. */
  refreshFit(): void {
    const mode = this.getScaleMode();
    if (mode) {
      this.viewer.currentScaleValue = mode;
    } else {
      this.viewer.update();
    }
  }

  onScaleChange(
    listener: (scale: number, mode: NamedScale | null) => void,
  ): () => void {
    this.scaleListeners.add(listener);
    return () => {
      this.scaleListeners.delete(listener);
    };
  }

  private emitScale(): void {
    const s = this.getScale();
    const m = this.getScaleMode();
    for (const cb of this.scaleListeners) cb(s, m);
  }

  destroy(): void {
    this.scaleListeners.clear();
    try {
      // PDFViewer.setDocument accepts null at runtime to clear the viewer
      // (its TS types are stricter than the runtime contract).
      this.viewer.setDocument(null as unknown as pdfjs.PDFDocumentProxy);
    } catch {
      // Some versions throw if no document was ever set — safe to ignore.
    }
    this.currentDoc?.destroy();
    this.currentDoc = null;
  }
}

function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
}

/**
 * Request a compilation from the backend and feed the bytes into the
 * controller. Status callbacks are routed back to the caller.
 */
export async function compile(
  controller: PdfPreviewController | null,
  options: CompileOptions,
): Promise<void> {
  if (compileInFlight) return;
  compileInFlight = true;
  options.onStatus('Compiling…', 'compiling');

  try {
    const { data } = await postApiDocumentsByIdCompile({
      path: { id: options.docId },
      parseAs: 'arrayBuffer',
      throwOnError: true,
    });

    let pdfBytes: Uint8Array | null = null;
    const rawData: unknown = data;
    if (rawData instanceof ArrayBuffer) {
      pdfBytes = new Uint8Array(rawData);
    } else if (rawData instanceof Blob) {
      pdfBytes = new Uint8Array(await rawData.arrayBuffer());
    }

    if (!pdfBytes || pdfBytes.byteLength === 0) {
      latest.bytes = null;
      latest.blob = null;
      options.onError('Compilation succeeded but returned an empty PDF.');
      options.onStatus('Compile error', 'error');
      return;
    }

    latest.bytes = pdfBytes;
    latest.blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
      type: 'application/pdf',
    });

    if (controller) {
      await controller.loadPdf(pdfBytes);
    }
    options.onStatus('Connected', 'connected');
  } catch (err) {
    latest.bytes = null;
    latest.blob = null;
    const message = getApiErrorMessage(err) ?? String(err);
    options.onError(message);
    options.onStatus('Compile error', 'error');
  } finally {
    compileInFlight = false;
  }
}

export function hasCompiledPdf(): boolean {
  return latest.blob !== null;
}

export function downloadLatestPdf(filename = 'main.pdf'): boolean {
  if (!latest.blob) return false;
  const url = URL.createObjectURL(latest.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/**
 * Render a pdflatex error message into the given panel, keeping only the
 * most relevant lines (markers like "!" / "l.<n>" / "Error"). Falls back to
 * the first 2KB if nothing matches.
 */
export function showErrorMessage(panel: HTMLElement, message: string): void {
  panel.style.display = 'block';
  panel.replaceChildren();
  const relevantLines = message
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('!') || line.startsWith('l.') || line.includes('Error'),
    )
    .slice(0, 30);
  const pre = document.createElement('pre');
  pre.className = 'm-0 whitespace-pre-wrap break-words font-mono text-xs';
  pre.textContent =
    relevantLines.length > 0
      ? relevantLines.join('\n')
      : message.slice(0, 2000);
  panel.appendChild(pre);
}

export function clearErrorPanel(errorPanel: HTMLElement): void {
  errorPanel.style.display = 'none';
  errorPanel.textContent = '';
}
