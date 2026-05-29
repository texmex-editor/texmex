import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CompileToggleButton } from './CompileToggleButton';
import { PdfZoomDropdown } from './PdfZoomDropdown';
import {
  ChevronDown,
  FileArchive,
  FileDown,
  Play,
} from 'lucide-react';
import type { NamedScale, ScaleValue } from '@/utils/preview';
import 'pdfjs-dist/web/pdf_viewer.css';

interface PDFPreviewProps {
  /** Container element for PDFViewer (the scrollable parent). */
  onPdfContainerReady?: (container: HTMLDivElement) => void;
  /** Inner .pdfViewer element PDFViewer appends pages into. */
  onPdfViewerReady?: (viewer: HTMLDivElement) => void;
  /** Error-panel ref kept compatible with hook's imperative use. */
  onErrorPanelReady?: (panel: HTMLElement) => void;
  onExportPdf?: () => void;
  onExportProject?: () => void;
  onCompile?: () => void;
  canExportPdf?: boolean;
  isCompilingOn?: boolean;
  onToggleCompiling?: () => void;
  /** Message shown over the viewer when there's no PDF to render. */
  placeholderMessage?: string | null;
  /** Current numeric scale (1 = 100%). */
  zoomScale: number;
  /** Active named mode (page-width / page-fit / …) or null when numeric. */
  zoomMode: NamedScale | null;
  onSelectZoom: (value: ScaleValue) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export const PDFPreview: React.FC<PDFPreviewProps> = ({
  onPdfContainerReady,
  onPdfViewerReady,
  onErrorPanelReady,
  onExportPdf,
  onExportProject,
  onCompile,
  canExportPdf,
  isCompilingOn,
  onToggleCompiling,
  placeholderMessage,
  zoomScale,
  zoomMode,
  onSelectZoom,
  onZoomIn,
  onZoomOut,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const errorPanelRef = useRef<HTMLPreElement>(null);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        exportRef.current &&
        !exportRef.current.contains(event.target as Node)
      ) {
        setShowExportOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      onPdfContainerReady?.(containerRef.current);
    }
    if (viewerRef.current) {
      onPdfViewerReady?.(viewerRef.current);
    }
    if (errorPanelRef.current) {
      onErrorPanelReady?.(errorPanelRef.current);
    }
  }, [onPdfContainerReady, onPdfViewerReady, onErrorPanelReady]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>Preview (PDF)</span>
          {onToggleCompiling && typeof isCompilingOn !== 'undefined' && (
            <div className="flex items-center gap-2">
              <CompileToggleButton
                isCompilingOn={isCompilingOn}
                onToggleCompiling={onToggleCompiling}
              />
              {!isCompilingOn && onCompile && (
                <Button
                  type="button"
                  onClick={onCompile}
                  size="sm"
                  variant="outline"
                  className="animate-in fade-in-0 duration-200"
                >
                  <Play className="h-4 w-4" />
                  Compile now
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <PdfZoomDropdown
            scale={zoomScale}
            mode={zoomMode}
            onSelectScale={onSelectZoom}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
          />

          <div className="relative" ref={exportRef}>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowExportOptions(!showExportOptions)}
            >
              <FileDown className="h-4 w-4" />
              Export
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>

            {showExportOptions && (
              <div className="absolute right-0 top-full z-[100] mt-1 w-40 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-md shadow-black/20">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                  onClick={() => {
                    onExportPdf?.();
                    setShowExportOptions(false);
                  }}
                  disabled={!canExportPdf}
                >
                  <FileDown className="h-4 w-4" />
                  <span>Export as PDF</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onExportProject?.();
                    setShowExportOptions(false);
                  }}
                >
                  <FileArchive className="h-4 w-4" />
                  <span>Export project (.zip)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PDF area — the viewer's container is the scrollable parent, with the
          .pdfViewer div inside it. Placeholder and error overlays are siblings
          of the scroll container so they never mutate the viewer's DOM. */}
      <div className="relative flex-1 overflow-hidden bg-muted/30">
        <div
          ref={containerRef}
          className="texmex-pdf-container absolute inset-0 overflow-auto"
        >
          <div ref={viewerRef} className="pdfViewer" />
        </div>

        {placeholderMessage && (
          <div
            id="placeholder"
            className="pointer-events-none absolute inset-0 flex items-center justify-center px-4"
          >
            <p className="text-center text-sm text-muted-foreground">
              {placeholderMessage}
            </p>
          </div>
        )}

        <pre
          ref={errorPanelRef}
          style={{ display: 'none' }}
          className="absolute inset-0 z-20 m-0 overflow-auto whitespace-pre-wrap bg-rose-50 p-4 font-mono text-xs text-rose-900"
        />
      </div>
    </div>
  );
};
