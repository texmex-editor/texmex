import React, { useEffect, useRef } from 'react';
import type {
  AwarenessPresenceUser,
  AwarenessUser,
  EditorSetup,
  FileEventMessage,
  SelectionOverlayState,
} from '../utils/editor';
import { createEditor, SNIPPET_DRAG_MIME } from '../utils/editor';

interface LatexEditorProps {
  docId: string;
  wsUrl: string;
  activeFileId?: string;
  collaborative?: boolean;
  initialText?: string;
  onStatusChange: (status: string, cls: string) => void;
  isReadOnly?: boolean;
  isAnonymousSession?: boolean;
  initialYjsState?: Uint8Array | null;
  onDocChange?: () => void;
  onSelectionChange?: (selection: SelectionOverlayState) => void;
  onEditorReady?: (setup: EditorSetup) => void;
  onPermissionDenied?: (message: string) => void;
  onAccessRevoked?: () => void;
  onConnectionLost?: () => void;
  awarenessUser?: AwarenessUser;
  onAwarenessUsersChange?: (
    users: AwarenessPresenceUser[],
    activeFileId: string,
  ) => void;
  onFileEvent?: (event: FileEventMessage) => void;
  onConnected?: () => void;
  onVersionRestored?: () => void;
  onSnippetDrop?: (snippet: string, clientX: number, clientY: number) => void;
  onFileDrop?: (files: File[], clientX: number, clientY: number) => void;
}

export const LatexEditor: React.FC<LatexEditorProps> = ({
  docId,
  wsUrl,
  activeFileId,
  collaborative = true,
  initialText,
  onStatusChange,
  isReadOnly,
  isAnonymousSession,
  initialYjsState,
  onDocChange,
  onSelectionChange,
  onEditorReady,
  onPermissionDenied,
  onAccessRevoked,
  onConnectionLost,
  awarenessUser,
  onAwarenessUsersChange,
  onFileEvent,
  onConnected,
  onVersionRestored,
  onSnippetDrop,
  onFileDrop,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorSetupRef = useRef<EditorSetup | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  const onDocChangeRef = useRef(onDocChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onEditorReadyRef = useRef(onEditorReady);
  const onPermissionDeniedRef = useRef(onPermissionDenied);
  const onAccessRevokedRef = useRef(onAccessRevoked);
  const onConnectionLostRef = useRef(onConnectionLost);
  const awarenessUsersChangeRef = useRef(onAwarenessUsersChange);
  const fileEventRef = useRef(onFileEvent);
  const connectedRef = useRef(onConnected);
  const versionRestoredRef = useRef(onVersionRestored);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    onDocChangeRef.current = onDocChange;
    onSelectionChangeRef.current = onSelectionChange;
    onEditorReadyRef.current = onEditorReady;
    onPermissionDeniedRef.current = onPermissionDenied;
    onAccessRevokedRef.current = onAccessRevoked;
    onConnectionLostRef.current = onConnectionLost;
    awarenessUsersChangeRef.current = onAwarenessUsersChange;
    fileEventRef.current = onFileEvent;
    connectedRef.current = onConnected;
    versionRestoredRef.current = onVersionRestored;
  }, [
    onStatusChange,
    onDocChange,
    onSelectionChange,
    onEditorReady,
    onPermissionDenied,
    onAccessRevoked,
    onConnectionLost,
    onAwarenessUsersChange,
    onFileEvent,
    onConnected,
    onVersionRestored,
  ]);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!onSnippetDrop && !onFileDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!onSnippetDrop && !onFileDrop) return;

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length > 0 && onFileDrop) {
      event.preventDefault();
      event.stopPropagation();
      onFileDrop(droppedFiles, event.clientX, event.clientY);
      return;
    }

    if (!onSnippetDrop) return;

    const snippet =
      event.dataTransfer.getData(SNIPPET_DRAG_MIME) ||
      event.dataTransfer.getData('text/plain');
    if (!snippet) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSnippetDrop(snippet, event.clientX, event.clientY);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    if (collaborative && !activeFileId) return;

    // Clear any previous editor instance
    containerRef.current.innerHTML = '';

    const setup = createEditor(
      containerRef.current,
      docId,
      wsUrl,
      (status, cls) => onStatusChangeRef.current(status, cls),
      {
        isReadOnly,
        isAnonymousSession,
        collaborative,
        initialText,
        activeFileId,
        initialYjsState,
        onDocChange: () => onDocChangeRef.current?.(),
        onSelectionChange: (selection) =>
          onSelectionChangeRef.current?.(selection),
        onPermissionDenied: (message) =>
          onPermissionDeniedRef.current?.(message),
        onAccessRevoked: () => onAccessRevokedRef.current?.(),
        onConnectionLost: () => onConnectionLostRef.current?.(),
        awarenessUser,
        onAwarenessUsersChange: (users, fileId) =>
          awarenessUsersChangeRef.current?.(users, fileId),
        onFileEvent: (event) => fileEventRef.current?.(event),
        onConnected: () => connectedRef.current?.(),
        onVersionRestored: () => versionRestoredRef.current?.(),
      },
    );

    editorSetupRef.current = setup;
    onEditorReady?.(setup);

    return () => {
      // Cleanup on unmount
      editorSetupRef.current?.cleanup?.();
      awarenessUsersChangeRef.current?.([], '');
    };
  }, [
    docId,
    wsUrl,
    collaborative,
    initialText,
    onStatusChange,
    isAnonymousSession,
    initialYjsState,
    awarenessUser,
  ]);

  useEffect(() => {
    editorSetupRef.current?.setReadOnly?.(Boolean(isReadOnly));
  }, [isReadOnly]);

  useEffect(() => {
    if (!collaborative) return;
    if (!activeFileId) return;
    editorSetupRef.current?.setActiveFileId?.(activeFileId);
  }, [activeFileId, collaborative]);

  return (
    <div
      ref={containerRef}
      style={{ height: '100%' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    />
  );
};
