import React from 'react';
import * as monaco from 'monaco-editor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ensureLatexLanguageRegistered, LATEX_LANGUAGE_ID } from '@/utils/monacoLatex';

type VersionDiffDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalText: string;
  modifiedText: string;
  title: string;
  description: string;
  isLoading?: boolean;
  errorMessage?: string | null;
  onApplyVersion?: () => void;
  isApplying?: boolean;
  applyLabel?: string;
};

export const VersionDiffDialog: React.FC<VersionDiffDialogProps> = ({
  open,
  onOpenChange,
  originalText,
  modifiedText,
  title,
  description,
  isLoading = false,
  errorMessage = null,
  onApplyVersion,
  isApplying = false,
  applyLabel = 'Apply version',
}) => {
  const [containerElement, setContainerElement] = React.useState<HTMLDivElement | null>(null);
  const diffEditorRef = React.useRef<monaco.editor.IStandaloneDiffEditor | null>(
    null,
  );
  const editorHostRef = React.useRef<HTMLDivElement | null>(null);
  const originalModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const layoutFrameRef = React.useRef<number | null>(null);

  const disposeDiffResources = React.useCallback(() => {
    diffEditorRef.current?.dispose();
    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();
    diffEditorRef.current = null;
    originalModelRef.current = null;
    modifiedModelRef.current = null;
    editorHostRef.current = null;
  }, []);

  React.useEffect(() => {
    return () => {
      if (layoutFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
      }
      disposeDiffResources();
    };
  }, [disposeDiffResources]);

  React.useEffect(() => {
    if (!open || isLoading || errorMessage || !containerElement) {
      return;
    }

    ensureLatexLanguageRegistered();

    const hostChanged =
      Boolean(diffEditorRef.current) && editorHostRef.current !== containerElement;

    if (hostChanged) {
      disposeDiffResources();
    }

    if (!diffEditorRef.current) {
      originalModelRef.current = monaco.editor.createModel(originalText, LATEX_LANGUAGE_ID);
      modifiedModelRef.current = monaco.editor.createModel(modifiedText, LATEX_LANGUAGE_ID);

      diffEditorRef.current = monaco.editor.createDiffEditor(containerElement, {
        theme: 'vs-dark',
        automaticLayout: true,
        renderSideBySide: true,
        readOnly: true,
        originalEditable: false,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        fontSize: 13,
        ignoreTrimWhitespace: false,
      });

      diffEditorRef.current.setModel({
        original: originalModelRef.current,
        modified: modifiedModelRef.current,
      });
      editorHostRef.current = containerElement;
    } else {
      originalModelRef.current?.setValue(originalText);
      modifiedModelRef.current?.setValue(modifiedText);
    }

    if (layoutFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutFrameRef.current);
    }

    // Radix dialog animation can report transient zero size; layout on next frame.
    layoutFrameRef.current = window.requestAnimationFrame(() => {
      diffEditorRef.current?.layout();
    });
  }, [open, isLoading, errorMessage, originalText, modifiedText, containerElement, disposeDiffResources]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent forceMount className="sm:max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative h-[65vh] min-h-[420px] overflow-hidden rounded-md border border-border">
          <div
            ref={setContainerElement}
            className={isLoading || errorMessage ? 'h-full w-full opacity-0' : 'h-full w-full'}
          />
          {isLoading && (
            <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Loading version snapshot...
            </p>
          )}
          {!isLoading && errorMessage && (
            <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-destructive">
              {errorMessage}
            </p>
          )}
        </div>

        {onApplyVersion && (
          <DialogFooter>
            <Button
              type="button"
              onClick={onApplyVersion}
              disabled={isLoading || Boolean(errorMessage) || isApplying}
            >
              {isApplying ? 'Applying...' : applyLabel}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
