import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  defineNewColor,
  getActiveFormats,
  getDefinedColors,
  unwrapSelection,
  wrapSelection,
  type DefinedColor,
} from '@/utils/format';
import { Plus } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

interface FormatTabProps {
  editorSetup: EditorSetup | null;
}

export const FormatTab: React.FC<FormatTabProps> = ({ editorSetup }) => {
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);
  const [definedColors, setDefinedColors] = useState<DefinedColor[]>([]);
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#3b82f6');
  const [showAddColor, setShowAddColor] = useState(false);

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

  const updateDefinedColors = useCallback(() => {
    if (!editorSetup?.editor) return;
    const model = editorSetup.editor.getModel();
    if (!model) return;
    const colors = getDefinedColors(model.getValue());
    setDefinedColors(colors);
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
      updateDefinedColors();
    });

    // Initial update
    updateActiveFormats();
    updateDefinedColors();

    return () => {
      disposable.dispose();
      modelDisposable.dispose();
    };
  }, [editorSetup?.editor, updateActiveFormats, updateDefinedColors]);

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

  const handleAddColor = useCallback(() => {
    if (!editorSetup?.editor || !newColorName || !newColorHex) return;
    // LaTeX HTML color spec is RRGGBB without #
    const spec = newColorHex.startsWith('#')
      ? newColorHex.substring(1).toUpperCase()
      : newColorHex.toUpperCase();
    defineNewColor(editorSetup.editor, newColorName, 'HTML', spec);
    setNewColorName('');
    setShowAddColor(false);
  }, [editorSetup?.editor, newColorName, newColorHex]);

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
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Color
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setShowAddColor(!showAddColor)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {showAddColor && (
            <div className="mb-2 space-y-2 rounded-md border border-border p-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Name"
                  value={newColorName}
                  onChange={(e) => setNewColorName(e.target.value)}
                  className="h-8 text-xs"
                />
                <input
                  type="color"
                  value={newColorHex}
                  onChange={(e) => setNewColorHex(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded-md border border-input bg-transparent"
                />
              </div>
              <Button
                size="sm"
                className="h-7 w-full text-[10px]"
                onClick={handleAddColor}
                disabled={!newColorName}
              >
                Add Color
              </Button>
            </div>
          )}

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
            {definedColors.map((color) => (
              <Tooltip key={color.name}>
                <TooltipTrigger asChild>
                  <button
                    className="h-8 w-full rounded-lg border-2 border-border transition-all hover:scale-110 hover:border-foreground"
                    style={{ backgroundColor: color.hex }}
                    onClick={() => handleColorClick(color.name)}
                    aria-label={color.name}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {color.name} ({color.hex})
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
