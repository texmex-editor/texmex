import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  type NamedScale,
  type ScaleValue,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PRESETS,
} from '@/utils/preview';

type Props = {
  /** Current numeric scale, e.g. 1 for 100%. Reported by the viewer. */
  scale: number;
  /** Named scale mode if active (page-width / page-fit / ...), null when numeric. */
  mode: NamedScale | null;
  onSelectScale: (value: ScaleValue) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

function clampPercent(percent: number): number {
  return Math.max(
    Math.round(ZOOM_MIN * 100),
    Math.min(Math.round(ZOOM_MAX * 100), percent),
  );
}

function formatPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export const PdfZoomDropdown: React.FC<Props> = ({
  scale,
  mode,
  onSelectScale,
  onZoomIn,
  onZoomOut,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(formatPercent(scale));
  const inputRef = useRef<HTMLInputElement>(null);

  // Resync the editable % input whenever the viewer reports a new scale and
  // the input isn't currently being edited.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(formatPercent(scale));
    }
  }, [scale]);

  const commitDraft = () => {
    const digits = draft.replace(/[^\d]/g, '');
    if (!digits) {
      setDraft(formatPercent(scale));
      return;
    }
    const next = clampPercent(parseInt(digits, 10));
    onSelectScale(next / 100);
    setDraft(`${next}%`);
  };

  const triggerLabel =
    mode === 'page-width'
      ? `${formatPercent(scale)} · Fit width`
      : mode === 'page-fit' || mode === 'page-height'
        ? `${formatPercent(scale)} · Fit page`
        : mode === 'page-actual'
          ? '100%'
          : mode === 'auto'
            ? `${formatPercent(scale)} · Auto`
            : formatPercent(scale);

  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-background px-1 py-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onZoomOut}
        aria-label="Zoom out"
      >
        <Minus className="h-4 w-4" />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex min-w-[7.5rem] items-center justify-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            aria-label="Change zoom"
          >
            <span className="tabular-nums">{triggerLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 gap-2 p-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitDraft();
              setOpen(false);
            }}
            className="flex items-center gap-1"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitDraft}
              onFocus={(event) => event.target.select()}
              inputMode="numeric"
              className="h-7 flex-1 rounded-sm border border-input bg-background px-2 text-xs tabular-nums focus:border-ring focus:outline-none"
              aria-label="Custom zoom percent"
            />
            <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
              Go
            </Button>
          </form>

          <div className="-mx-2 my-1 h-px bg-border" />

          <DropdownItem
            label="Fit to width"
            shortcut="Ctrl+0"
            selected={mode === 'page-width'}
            onClick={() => {
              onSelectScale('page-width');
              setOpen(false);
            }}
          />
          <DropdownItem
            label="Fit to page"
            shortcut="Ctrl+9"
            selected={mode === 'page-fit' || mode === 'page-height'}
            onClick={() => {
              onSelectScale('page-fit');
              setOpen(false);
            }}
          />

          <div className="-mx-2 my-1 h-px bg-border" />

          <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Zoom to
          </p>
          {ZOOM_PRESETS.map((preset) => {
            const isActive = !mode && Math.abs(scale - preset) < 0.005;
            return (
              <DropdownItem
                key={preset}
                label={formatPercent(preset)}
                selected={isActive}
                onClick={() => {
                  onSelectScale(preset);
                  setOpen(false);
                }}
              />
            );
          })}
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onZoomIn}
        aria-label="Zoom in"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
};

const DropdownItem: React.FC<{
  label: string;
  shortcut?: string;
  selected?: boolean;
  onClick: () => void;
}> = ({ label, shortcut, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-muted"
  >
    <span className="flex items-center gap-2">
      <Check
        className={`h-3 w-3 ${selected ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden
      />
      {label}
    </span>
    {shortcut && (
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {shortcut}
      </span>
    )}
  </button>
);
