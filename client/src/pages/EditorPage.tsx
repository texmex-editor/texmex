import { FormulaEditDialog } from '@/components/FormulaEditDialog';
import { Button } from '@/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import React from 'react';
import type { AuthResponse } from '../client';
import { LatexEditor } from '../components/LatexEditor.tsx';
import { DocumentTitleEditor } from './../components/DocumentTitleEditor';
import { EditorDocumentSettings } from './../components/EditorDocumentSettings';
import { FloatingEditorPalette } from './../components/FloatingEditorPalette';
import { PDFPreview } from './../components/PDFPreview';
import { SnippetSidebar } from './../components/SnippetSidebar';
import { Toolbar } from './../components/Toolbar';
import { EditorDocumentHeader } from './editor/EditorDocumentHeader';
import { EditorTabsBar } from './editor/EditorTabsBar';
import { WS_URL } from './editor/constants';
import { BASIC_LATEX_TEMPLATE } from './editor/fileEditorUtils';
import { useEditorCoordinator } from './editor/useEditorCoordinator';

type EditorPageProps = {
  user: AuthResponse | null;
  onLogout: () => Promise<void> | void;
  onUserUpdated?: (user: AuthResponse) => void;
};

const EditorPage: React.FC<EditorPageProps> = ({ user, onLogout, onUserUpdated }) => {
  const {
    activeFilePreviewUrl,
    activeFileTab,
    activeFormula,
    activeEditorTabKey,
    autosaveStatus,
    avatarUsers,
    awarenessUser,
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
    effectiveRole,
    formulaOverlay,
    handleAccessRevoked,
    handleAddTableRow,
    handleApplyDocumentSettings,
    handleApplyVersion,
    handleCloseFileTab,
    handleConnectionLost,
    handleConnected,
    handleDocChange,
    handleAwarenessUsersChange,
    handleEditorReady,
    handleErrorPanelReady,
    handleCompile,
    handleExportPdf,
    handleExportProject,
    handleFileDocChange,
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
    hasApiDocumentId,
    initialYjsState,
    isAnonymousSession,
    isCompilingOn,
    isFormulaDialogOpen,
    isInTable,
    isLoadingInitialState,
    isDownloadOnlyFile,
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
    setIsSnippetSidebarCollapsed,
    setStatusState,
    sidebarActiveFilePath,
    sidebarEditingUsersByPath,
    snippetSidebarPanelRef,
    status,
    statusClass,
    entrypointFileId,
    handleCloseReplaceBanner,
    handleFileEvent,
    handleVersionRestored,
  } = useEditorCoordinator({ user });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Toolbar
        docId={docId}
        hasApiDocumentId={hasApiDocumentId}
        status={status}
        statusClass={statusClass}
        user={user}
        role={effectiveRole}
        canManageCollaborators={isOwner}
        onLogout={onLogout}
        onUserUpdated={onUserUpdated}
        centerSlot={
          hasApiDocumentId ? (
            <DocumentTitleEditor
              docId={docId}
              hasApiDocumentId={hasApiDocumentId}
              title={documentTitle}
              canRename={isOwner}
              canSaveTemplate={!isAnonymousSession && !isViewer}
              onRename={(next) => handleRenameDocument(next)}
              isRenamePending={renameDocumentMutation.isPending}
              renameError={renameError}
            />
          ) : null
        }
      />

      <div className="min-h-0 flex-1 p-3 ">
        <div className="flex h-full min-h-0 gap-3">
          <ResizablePanelGroup direction="horizontal" className="gap-2">
            <ResizablePanel
              ref={snippetSidebarPanelRef}
              className="min-w-0 overflow-y-auto overflow-x-hidden"
              // Default sidebar width bumped from 15% to 25% (was 20% briefly)
              // so the Files panel header + tree rows breathe at common laptop
              // widths. Users can still drag the handle smaller or collapse to
              // icon-only via the toggle.
              defaultSize={25}
              minSize={15}
              collapsible
              collapsedSize={2}
              onCollapse={() => setIsSnippetSidebarCollapsed(true)}
              onExpand={() => setIsSnippetSidebarCollapsed(false)}
            >
              <SnippetSidebar
                onSnippetInsert={handleSnippetInsert}
                documentText={documentText}
                docId={docId}
                hasApiDocumentId={hasApiDocumentId}
                canManageFiles={canEditFiles}
                documentTitle={documentTitle}
                entrypoint={documentQuery.data?.entrypoint ?? 'main.tex'}
                activeFilePath={sidebarActiveFilePath}
                editingUsersByPath={sidebarEditingUsersByPath}
                onOpenFile={handleOpenFile}
                onOpenMainFile={() => setActiveEditorTabKey('main')}
                onApplyVersion={isViewer ? undefined : handleApplyVersion}
                canRestoreVersion={!isViewer}
                onSetEntrypoint={isOwner ? handleSetEntrypoint : undefined}
                isCollapsed={isSnippetSidebarCollapsed}
                onToggleCollapse={handleSnippetSidebarToggle}
                editorSetup={editorSetup}
              />
            </ResizablePanel>

            <ResizableHandle className="p2" withHandle />

            <ResizablePanel defaultSize={52} minSize={25}>
              <div className="flex h-full min-h-0 flex-col rounded-xl border border-border min-w-0 flex-1  bg-card shadow-soft">
                <EditorDocumentHeader
                  autosaveStatus={autosaveStatus}
                  hasApiDocumentId={hasApiDocumentId}
                  role={effectiveRole}
                  avatarUsers={avatarUsers}
                  documentQueryError={documentQuery.isError}
                />

                <div className="flex min-h-0 flex-1 flex-col ">
                  <EditorTabsBar
                    isMainTabActive={isMainTabActive}
                    activeEditorTabKey={activeEditorTabKey}
                    openFileTabs={openFileTabs}
                    onSelectMain={() => setActiveEditorTabKey('main')}
                    onSelectFileTab={setActiveEditorTabKey}
                    onCloseFileTab={handleCloseFileTab}
                  />

                  <div className="relative min-h-0 flex-1 overflow-hidden">
                    <EditorDocumentSettings
                      editorSetup={editorSetup}
                      currentSettings={currentSettings}
                      onApply={handleApplyDocumentSettings}
                    />


                    {selectionOverlay.visible &&
                      (selectedText || isInTable) &&
                      (isMainTabActive || activeFileTab?.isTextEditable) && (
                        <FloatingEditorPalette
                          onWrap={handleWrapSelection}
                          onUnwrap={handleUnwrapSelection}
                          activeFormats={selectionOverlay.activeFormats}
                          onAddTableRow={handleAddTableRow}
                          isInTable={isInTable}
                          top={selectionOverlay.top}
                          left={selectionOverlay.left}
                        />
                      )}

                    {formulaOverlay?.visible &&
                      (isMainTabActive || activeFileTab?.isTextEditable) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="absolute z-20 h-8 rounded-full border-border bg-background/95 px-3 text-xs shadow-soft backdrop-blur-sm"
                          style={{
                            top: `${formulaOverlay.top}px`,
                            left: `${formulaOverlay.left}px`,
                          }}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={handleOpenFormulaDialog}
                        >
                          Edit formula
                        </Button>
                      )}

                    <FormulaEditDialog
                      open={isFormulaDialogOpen}
                      formula={activeFormula}
                      onOpenChange={handleFormulaDialogChange}
                      onSave={handleSaveFormula}
                    />

                    {isLoadingInitialState ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Loading document content...
                      </div>
                    ) : isOpeningFile ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Opening file...
                      </div>
                    ) : (
                      <>
                        <div
                          className={
                            isMainTabActive || activeFileTab?.isCollaborative
                              ? 'h-full'
                              : 'hidden h-full'
                          }
                        >
                          <LatexEditor
                            docId={docId}
                            wsUrl={WS_URL}
                            activeFileId={
                              isMainTabActive
                                ? entrypointFileId ?? undefined
                                : activeFileTab?.isCollaborative
                                  ? activeFileTab.fileId
                                  : entrypointFileId ?? undefined
                            }
                            onStatusChange={setStatusState}
                            initialYjsState={initialYjsState}
                            onDocChange={handleDocChange}
                            onSelectionChange={handleSelectionChange}
                            onEditorReady={handleEditorReady}
                            isReadOnly={isViewer}
                            isAnonymousSession={isAnonymousSession}
                            onPermissionDenied={handlePermissionDenied}
                            onAccessRevoked={handleAccessRevoked}
                            onConnectionLost={handleConnectionLost}
                            awarenessUser={awarenessUser}
                            onAwarenessUsersChange={handleAwarenessUsersChange}
                            onFileEvent={handleFileEvent}
                            onConnected={handleConnected}
                            onVersionRestored={handleVersionRestored}
                            onSnippetDrop={handleSnippetDrop}
                            onFileDrop={handleFileDrop}
                          />
                        </div>

                        {!isMainTabActive &&
                          activeFileTab?.isTextEditable &&
                          !activeFileTab.isCollaborative && (
                            <LatexEditor
                              key={activeFileTab.key}
                              docId={docId}
                              wsUrl={WS_URL}
                              onStatusChange={setStatusState}
                              collaborative={false}
                              initialText={activeFileTab.initialText ?? ''}
                              onDocChange={handleFileDocChange}
                              onSelectionChange={handleSelectionChange}
                              onEditorReady={handleFileEditorReady}
                              isReadOnly={isViewer}
                              isAnonymousSession={isAnonymousSession}
                              onSnippetDrop={handleSnippetDrop}
                              onFileDrop={handleFileDrop}
                            />
                          )}

                        {!isMainTabActive &&
                          activeFileTab?.isTextEditable &&
                          activeFileTab.isCollaborative && (
                            <div className="sr-only">
                              Collaborative file uses the main editor.
                            </div>
                          )}

                        {activeFileTab && !activeFileTab.isTextEditable && (
                          <div className="absolute inset-0 z-10 flex h-full items-center justify-center p-6">
                            {canPreviewActiveFileImage &&
                            activeFilePreviewUrl ? (
                              <div className="flex h-full w-full max-w-5xl flex-col rounded-xl border border-border bg-background p-4">
                                <p className="mb-3 text-sm font-medium text-foreground">
                                  Image preview: {activeFileTab.filename}
                                </p>
                                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted/30 p-2">
                                  <img
                                    src={activeFilePreviewUrl}
                                    alt={activeFileTab.filename}
                                    className="mx-auto max-h-full w-auto max-w-full object-contain"
                                  />
                                </div>
                              </div>
                            ) : canPreviewActiveFilePdf &&
                              activeFilePreviewUrl ? (
                              <div className="flex h-full w-full max-w-5xl flex-col rounded-xl border border-border bg-background p-4">
                                <p className="mb-3 text-sm font-medium text-foreground">
                                  PDF preview: {activeFileTab.filename}
                                </p>
                                <embed
                                  src={activeFilePreviewUrl}
                                  type="application/pdf"
                                  className="min-h-0 flex-1 rounded-lg border border-border"
                                />
                              </div>
                            ) : isDownloadOnlyFile ? (
                              <div className="max-w-md rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
                                <p className="font-medium text-foreground">
                                  This file can’t be previewed in the editor.
                                </p>
                                <p className="mt-2">
                                  Download it from the Files tab to inspect it locally.
                                </p>
                              </div>
                            ) : (
                              <div className="max-w-md rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
                                <p className="font-medium text-foreground">
                                  This file is not editable as text.
                                </p>
                                <p className="mt-2">
                                  You can manage it from the Files tab and use
                                  it during compilation.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle className="p2" withHandle />

            <ResizablePanel defaultSize={48} minSize={20}>
              <div className="h-full">
                <PDFPreview
                  onPdfContainerReady={handlePdfContainerReady}
                  onPdfViewerReady={handlePdfViewerReady}
                  onErrorPanelReady={handleErrorPanelReady}
                  onExportPdf={handleExportPdf}
                  onExportProject={handleExportProject}
                  onCompile={handleCompile}
                  canExportPdf={canExportPdf}
                  isCompilingOn={isCompilingOn}
                  onToggleCompiling={handleToggleCompiling}
                  placeholderMessage={placeholderMessage}
                  zoomScale={zoomScale}
                  zoomMode={zoomMode}
                  onSelectZoom={handleSelectZoom}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
      {replaceBanner && (() => {
        // Tailor the banner copy to where the user is being sent: a text/collab file
        // opens in the editor; an image/pdf/font opens in the preview pane. Without
        // this, users hit "Open new file" without knowing whether they'll land in
        // edit mode or preview mode.
        const newCategoryIsEditable =
          replaceBanner.newCategory === 'collaborative' ||
          replaceBanner.newCategory === 'static_text';
        const newCategoryIsPreview =
          replaceBanner.newCategory === 'image' ||
          replaceBanner.newCategory === 'pdf';
        const detail = newCategoryIsEditable
          ? `Reopen "${replaceBanner.newFilename}" for editing?`
          : newCategoryIsPreview
            ? `Reopen "${replaceBanner.newFilename}" in the preview pane?`
            : `The open tab may no longer match the file list.`;
        const openLabel = newCategoryIsEditable
          ? 'Open for editing'
          : newCategoryIsPreview
            ? 'Open preview'
            : 'Open new file';
        return (
          <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
            <div className="flex max-w-xl items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 text-sm shadow-lg backdrop-blur">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  {replaceBanner.uploadedByDisplayName ?? 'Someone'} replaced this file.
                </p>
                <p className="text-muted-foreground">{detail}</p>
              </div>
              <Button type="button" onClick={handleOpenReplacedFile}>
                {openLabel}
              </Button>
              <Button type="button" variant="outline" onClick={handleCloseReplaceBanner}>
                Close tab
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default EditorPage;
