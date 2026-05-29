import React from 'react';
import { X } from 'lucide-react';
import type { OpenEditorFile } from './fileEditorUtils';

type EditorTabsBarProps = {
  isMainTabActive: boolean;
  activeEditorTabKey: string;
  openFileTabs: OpenEditorFile[];
  onSelectMain: () => void;
  onSelectFileTab: (tabKey: string) => void;
  onCloseFileTab: (tabKey: string) => void;
};

export const EditorTabsBar: React.FC<EditorTabsBarProps> = ({
  isMainTabActive,
  activeEditorTabKey,
  openFileTabs,
  onSelectMain,
  onSelectFileTab,
  onCloseFileTab,
}) => (
  <div className="flex items-center gap-1 border-b border-border bg-background/90 px-2 py-1">
    <button
      type="button"
      className={`rounded-md px-2 py-1 text-xs ${
        isMainTabActive
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/60'
      }`}
      onClick={onSelectMain}
    >
      main.tex
    </button>
    {openFileTabs.map((tab) => (
      <div
        key={tab.key}
        className={`flex items-center gap-1 rounded-md px-1 py-0.5 ${
          activeEditorTabKey === tab.key
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted/60'
        }`}
      >
        <button
          type="button"
          className="max-w-[180px] truncate px-1 text-xs"
          onClick={() => onSelectFileTab(tab.key)}
          title={tab.filename}
        >
          {tab.filename}
        </button>
        <button
          type="button"
          className="rounded p-0.5 hover:bg-background/80"
          onClick={() => onCloseFileTab(tab.key)}
          aria-label={`Close ${tab.filename}`}
        >
          <X className="size-3" />
        </button>
      </div>
    ))}
  </div>
);
