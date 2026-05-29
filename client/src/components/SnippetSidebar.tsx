import { cn } from '@/components/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  getSnippetCustomBlocks,
  getSnippetSections,
} from '@/snippets/plugins/registry';
import {
  serializeSnippetInsertion,
  type SnippetInsertion,
} from '@/snippets/snippetInsertion';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import React from 'react';
import type { EditorSetup } from '../utils/editor';
import { SNIPPET_DRAG_MIME } from '../utils/editor';
import { FilesTab } from './snippet-tabs/files/FilesTab';
import { FormatTab } from './snippet-tabs/format/FormatTab';
import { InfoTab } from './snippet-tabs/info/InfoTab';
import type { OpenFilePayload } from './snippet-tabs/files/types';

interface SnippetSidebarProps {
  onSnippetInsert: (insertion: SnippetInsertion) => void;
  documentText: string;
  docId: string;
  hasApiDocumentId: boolean;
  canManageFiles: boolean;
  /** Document title — surfaces in the Files panel header alongside the
   *  entrypoint pill so users have project context. */
  documentTitle?: string | null;
  entrypoint?: string;
  activeFilePath: string | null;
  editingUsersByPath?: Record<
    string,
    Array<{ id: string; name: string; color: string }>
  >;
  onOpenFile: (file: OpenFilePayload) => void;
  onOpenMainFile?: () => void;
  onApplyVersion?: (sourceText: string) => void;
  canRestoreVersion?: boolean;
  /** Set a new entrypoint by filename. Only the doc owner gets a non-undefined
   *  handler; the file tree hides its 'Set as main file' button otherwise. */
  onSetEntrypoint?: (filename: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  editorSetup: EditorSetup | null;
}

type TabName = 'insert' | 'format' | 'files' | 'info';

const TABS: { key: TabName; label: string }[] = [
  { key: 'insert', label: 'Insert' },
  { key: 'format', label: 'Format' },
  { key: 'files', label: 'Files' },
  { key: 'info', label: 'Info' },
];

// Title + subtitle shown in the sidebar header, per-tab. Subtitles are kept
// at or near 29 chars (the original "Drag snippets into the editor") so the
// header text doesn't wrap at typical sidebar widths.
const TAB_HEADERS: Record<TabName, { title: string; subtitle: string }> = {
  insert: { title: 'Snippets', subtitle: 'Drag snippets into the editor' },
  format: { title: 'Format', subtitle: 'Document layout and formatting' },
  files: { title: 'Files', subtitle: 'Browse, upload, and manage files' },
  info: { title: 'Info', subtitle: 'Activity, versions, and exports' },
};

export const SnippetSidebar: React.FC<SnippetSidebarProps> = ({
  onSnippetInsert,
  documentText,
  docId,
  hasApiDocumentId,
  canManageFiles,
  documentTitle,
  entrypoint,
  activeFilePath,
  editingUsersByPath,
  onOpenFile,
  onOpenMainFile,
  onApplyVersion,
  canRestoreVersion,
  onSetEntrypoint,
  isCollapsed,
  onToggleCollapse,
  editorSetup,
}) => {
  // Controlled active tab so the header (title + subtitle) can react to the
  // selection. Uncontrolled Tabs (defaultValue only) gave Radix internal
  // state we couldn't read; lifting it here adds one useState but keeps the
  // header in sync without a Tabs context hack.
  const [activeTab, setActiveTab] = React.useState<TabName>('insert');
  const activeHeader = TAB_HEADERS[activeTab];

  const mainEntrypointByteSize = React.useMemo(
    () => new TextEncoder().encode(documentText).length,
    [documentText],
  );

  const handleSnippetDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    insertion: SnippetInsertion,
  ) => {
    event.dataTransfer.setData(
      SNIPPET_DRAG_MIME,
      serializeSnippetInsertion(insertion),
    );
    event.dataTransfer.setData('text/plain', insertion.text);
    event.dataTransfer.effectAllowed = 'copy';
  };
  const insertSections = React.useMemo(() => getSnippetSections('insert'), []);
  const insertCustomBlocks = React.useMemo(
    () => getSnippetCustomBlocks('insert'),
    [],
  );

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col rounded-xl border border-border bg-background/95 shadow-soft backdrop-blur',
        isCollapsed ? 'p-2' : 'p-3',
      )}
    >
      <TooltipProvider delayDuration={120}>
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            isCollapsed ? 'items-center justify-start' : 'gap-3',
          )}
        >
          <div
            className={cn(
              'flex w-full items-center',
              isCollapsed ? 'justify-center' : 'justify-between gap-3',
            )}
          >
            {!isCollapsed && (
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {activeHeader.title}
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  {activeHeader.subtitle}
                </p>
              </div>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onToggleCollapse}
                  aria-label={
                    isCollapsed
                      ? 'Expand snippet sidebar'
                      : 'Minify snippet sidebar'
                  }
                >
                  {isCollapsed ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? 'right' : 'top'}>
                {isCollapsed ? 'Expand snippets' : 'Minify snippets'}
              </TooltipContent>
            </Tooltip>
          </div>

          <div
            aria-hidden={isCollapsed}
            className={cn(
              'min-h-0 flex-1 overflow-hidden',
              isCollapsed && 'hidden',
            )}
          >
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as TabName)}
              className="flex h-full min-h-0 w-full min-w-0 flex-col"
            >
              <TabsList className="grid h-auto w-full grid-cols-4 gap-1 bg-muted p-1">
                {TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.key}
                    value={tab.key}
                    className="px-1 py-1 text-xs"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <div className="min-h-0 flex-1  overflow-y-auto pr-1 pt-3">
                <TabsContent value="insert" className="space-y-4">
                  {insertSections.map((section) => (
                    <section key={section.id} className="space-y-2">
                      {section.title && (
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {section.title}
                        </h3>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {section.items.map((item) => (
                          <Button
                            key={item.id}
                            variant="outline"
                            className="h-auto flex-col items-start gap-1 rounded-xl p-3 text-left"
                            draggable
                            onDragStart={(event) =>
                              handleSnippetDragStart(event, item.createInsertion())
                            }
                            onClick={() => onSnippetInsert(item.createInsertion())}
                          >
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {item.icon}
                            </span>
                            <span className="text-xs text-foreground">
                              {item.label}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </section>
                  ))}

                  {insertCustomBlocks.map((block) => (
                    <section key={block.id} className="space-y-2">
                      {block.title && (
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {block.title}
                        </h3>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {block.render({
                          onInsertSnippet: onSnippetInsert,
                          onStartSnippetDrag: handleSnippetDragStart,
                        })}
                      </div>
                    </section>
                  ))}
                </TabsContent>

                <TabsContent value="format">
                  <FormatTab editorSetup={editorSetup} />
                </TabsContent>

                <TabsContent value="files" className="space-y-2">
                  <FilesTab
                    docId={docId}
                    hasApiDocumentId={hasApiDocumentId}
                    canEdit={canManageFiles}
                    documentTitle={documentTitle}
                    entrypoint={entrypoint}
                    mainEntrypointByteSize={mainEntrypointByteSize}
                    onOpenFile={onOpenFile}
                    onOpenMainFile={onOpenMainFile}
                    onSetEntrypoint={onSetEntrypoint}
                    activeFilePath={activeFilePath}
                    editingUsersByPath={editingUsersByPath}
                  />
                </TabsContent>

                <TabsContent value="info" className="space-y-2">
                  <InfoTab
                    documentText={documentText}
                    docId={docId}
                    hasApiDocumentId={hasApiDocumentId}
                    onApplyVersion={onApplyVersion}
                    canRestoreVersion={canRestoreVersion}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </TooltipProvider>
    </aside>
  );
};
