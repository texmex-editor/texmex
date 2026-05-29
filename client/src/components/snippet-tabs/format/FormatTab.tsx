import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { EditorSetup } from '@/utils/editor';
import {
  COLORS,
  FONT_SIZES,
  FORMATTING_ACTIONS,
  applyColor,
  applyFontSize,
  getActiveFormats,
  unwrapSelection,
  wrapSelection,
} from '@/utils/format';
import React, { useCallback, useEffect, useState } from 'react';

interface FormatTabProps {
  editorSetup: EditorSetup | null;
}

export const FormatTab: React.FC<FormatTabProps> = ({ editorSetup }) => {
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);

  const updateActiveFormats = useCallback(() => {
    if (!editorSetup?.editor) {
      setActiveFormats([]);
      setHasSelection(false);
      return;
    }

    const editor = editorSetup.editor;
    const selection = editor.getSelection();
    if (!selection) {
      setActiveFormats([]);
      setHasSelection(false);
      return;
    }

    const model = editor.getModel();
    if (!model) {
      setActiveFormats([]);
      setHasSelection(false);
      return;
    }

    const from = model.getOffsetAt(selection.getStartPosition());
    const to = model.getOffsetAt(selection.getEndPosition());
    const hasText = from !== to;

    setHasSelection(hasText);

    if (hasText) {
      const active = getActiveFormats(editor);
      setActiveFormats(active);
    } else {
      setActiveFormats([]);
    }
  }, [editorSetup?.editor]);

  useEffect(() => {
    if (!editorSetup?.editor) return;

    const editor = editorSetup.editor;

    // Update on selection change
    const disposable = editor.onDidChangeCursorSelection(() => {
      updateActiveFormats();
    });

    // Also update on content change (in case formatting changes)
    const modelDisposable = editor.onDidChangeModelContent(() => {
      updateActiveFormats();
    });

    // Initial update
    updateActiveFormats();

    return () => {
      disposable.dispose();
      modelDisposable.dispose();
    };
  }, [editorSetup?.editor, updateActiveFormats]);

  const handleFormatClick = useCallback(
    (before: string, after: string, title?: string) => {
      if (!editorSetup?.editor) return;

      const editor = editorSetup.editor;
      const selection = editor.getSelection();
      if (!selection) return;

      const model = editor.getModel();
      if (!model) return;

      const from = model.getOffsetAt(selection.getStartPosition());
      const to = model.getOffsetAt(selection.getEndPosition());

      // Check if already wrapped
      const doc = model.getValue();
      const fromWord = doc.slice(Math.max(0, from - before.length), from);
      const toWord = doc.slice(to, to + after.length);

      // If already wrapped, toggle it off (unwrap)
      if (fromWord === before && toWord === after && title) {
        unwrapSelection(editor, before, after);
      } else {
        wrapSelection(editor, before, after);
      }

      // Update active formats after formatting
      setTimeout(() => updateActiveFormats(), 0);
    },
    [editorSetup?.editor, updateActiveFormats],
  );

  const handleFontSizeClick = useCallback(
    (size: string) => {
      if (!editorSetup?.editor) return;
      applyFontSize(editorSetup.editor, size);
      setTimeout(() => updateActiveFormats(), 0);
    },
    [editorSetup?.editor, updateActiveFormats],
  );

  const handleColorClick = useCallback(
    (color: string) => {
      if (!editorSetup?.editor) return;
      applyColor(editorSetup.editor, color);
      setTimeout(() => updateActiveFormats(), 0);
    },
    [editorSetup?.editor, updateActiveFormats],
  );

  if (!editorSetup?.editor) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
        Loading editor...
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-3">
        {/* Text Formatting */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Text Formatting
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {FORMATTING_ACTIONS.slice(0, 5).map((action) => (
              <Tooltip key={action.title || action.label}>
                <TooltipTrigger asChild>
                  <Button
                    variant={
                      activeFormats.includes(action.title || action.label)
                        ? 'default'
                        : 'outline'
                    }
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() =>
                      handleFormatClick(
                        action.before,
                        action.after,
                        action.title,
                      )
                    }
                  >
                    {action.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {action.title || action.label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Font Size
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {FONT_SIZES.map((size) => (
              <Tooltip key={size.value}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() => handleFontSizeClick(size.value)}
                  >
                    {size.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {size.value}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Colors */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Color
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {COLORS.map((color) => (
              <Tooltip key={color.value}>
                <TooltipTrigger asChild>
                  <button
                    className="h-8 w-full rounded-lg border-2 border-border transition-all hover:scale-110 hover:border-foreground"
                    style={{
                      backgroundColor:
                        color.value === 'black' ? '#000' : color.value,
                    }}
                    onClick={() => handleColorClick(color.value)}
                    aria-label={color.label}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {color.label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Math & Environments */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Math & Structure
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {FORMATTING_ACTIONS.slice(5).map((action) => (
              <Tooltip key={action.title || action.label}>
                <TooltipTrigger asChild>
                  <Button
                    variant={
                      activeFormats.includes(action.title || action.label)
                        ? 'default'
                        : 'outline'
                    }
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() =>
                      handleFormatClick(
                        action.before,
                        action.after,
                        action.title,
                      )
                    }
                  >
                    {action.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {action.title || action.label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};
