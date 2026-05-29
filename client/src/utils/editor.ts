import * as monaco from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import {
  ensureLatexLanguageRegistered,
  LATEX_LANGUAGE_ID,
} from './monacoLatex';

export const SNIPPET_DRAG_MIME = 'application/x-texmex-snippet';

// Use a stable document ID from the URL hash, default to 'default'
export function getDocId(): string {
  if (window.location.hash) return window.location.hash.slice(1);
  const id = 'default';
  window.location.hash = id;
  return id;
}

export interface EditorSetup {
  editor: monaco.editor.IStandaloneCodeEditor;
  model: monaco.editor.ITextModel;
  provider?: WebsocketProvider;
  ydoc?: Y.Doc;
  binding?: MonacoBinding;
  setReadOnly?: (isReadOnly: boolean) => void;
  setActiveFileId?: (fileId: string) => void;
  lockCollaboration?: () => void;
  unlockCollaboration?: () => void;
  saveViewState?: () => monaco.editor.ICodeEditorViewState | null;
  restoreViewState?: (viewState: monaco.editor.ICodeEditorViewState | null) => void;
  cleanup?: () => void;
}

export interface SelectionOverlayState {
  text: string;
  visible: boolean;
  top: number;
  left: number;
  activeFormats: string[];
}

export interface AwarenessUser {
  id?: string | null;
  email?: string | null;
  displayName?: string | null;
}

export interface AwarenessPresenceUser {
  clientId: number;
  name: string;
  color: string;
}

export interface CreateEditorOptions {
  activeFileId?: string;
  collaborative?: boolean;
  initialText?: string;
  isReadOnly?: boolean;
  isAnonymousSession?: boolean;
  initialYjsState?: Uint8Array | null;
  onDocChange?: () => void;
  onSelectionChange?: (selection: SelectionOverlayState) => void;
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
}

const AWARENESS_STALE_MS = 15000; // remove users who haven't updated their presence in this many ms
const AWARENESS_POLL_MS = 5000;

type PermissionDeniedMessage = {
  type?: string;
  message?: string;
};

export type FileEventMessage = {
  type?: string;
  action?: string;
  [key: string]: unknown;
};

// Custom Yjs wire message type for our app-level control frames. Matches the
// server's CONTROL_MESSAGE_TYPE constant in YjsRelayMiddleware.cs. Type 0 is
// sync and 1 is awareness (y-protocols); 2+ is free for app use.
const CONTROL_MESSAGE_TYPE = 3;

const textDecoder = new TextDecoder();

/**
 * Parse a control message from a WebSocket frame. Returns null for any frame
 * that isn't our control type (sync, awareness, malformed, etc.) — callers
 * can ignore it.
 *
 * Supports binary frames in the new wire format ([3, ...utf8 JSON]).
 */
function parseControlPayload(
  payload: unknown,
): PermissionDeniedMessage | FileEventMessage | null {
  if (payload instanceof ArrayBuffer) {
    const bytes = new Uint8Array(payload);
    if (bytes.length < 2 || bytes[0] !== CONTROL_MESSAGE_TYPE) return null;
    try {
      const json = textDecoder.decode(bytes.subarray(1));
      return JSON.parse(json) as PermissionDeniedMessage | FileEventMessage;
    } catch {
      return null;
    }
  }
  return null;
}


function getDeterministicColor(seed: string, lightness: number): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsla(${hue}, 70%, 50%, ${lightness})`;
}

function escapeCssContent(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function createMonacoEditor(
  container: HTMLElement,
  model: monaco.editor.ITextModel,
  isReadOnly: boolean,
): monaco.editor.IStandaloneCodeEditor {
  const editor = monaco.editor.create(container, {
    model,
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    fontSize: 13,
    scrollBeyondLastLine: false,
    tabSize: 2,
    readOnly: isReadOnly,
  });

  // Swallow Ctrl/Cmd+S while Monaco is focused so the browser's default
  // "Save Page As" dialog doesn't pop up. The editor autosaves
  // AUTOSAVE_DEBOUNCE_MS (= 1.5s) after the last keystroke, so a manual
  // save isn't needed. The keybinding is intentionally a no-op — when
  // Monaco isn't focused the default browser behavior still applies, so
  // we don't intercept globally.
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    /* no-op: autosave handles persistence */
  });

  return editor;
}

function createSelectionEmitter(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  onSelectionChange?: (selection: SelectionOverlayState) => void,
): () => void {
  return () => {
    if (!onSelectionChange) return;

    const selection = editor.getSelection();
    if (!selection) {
      onSelectionChange({
        text: '',
        visible: false,
        top: 0,
        left: 0,
        activeFormats: [],
      });
      return;
    }

    const startPos = selection.getStartPosition();
    const startCoords = editor.getScrolledVisiblePosition(startPos);
    if (!startCoords) {
      onSelectionChange({
        text: '',
        visible: false,
        top: 0,
        left: 0,
        activeFormats: [],
      });
      return;
    }

    const selectedText = selection.isEmpty() ? '' : model.getValueInRange(selection);
    let left = startCoords.left;
    let top = startCoords.top - 10;

    if (!selection.isEmpty()) {
      const endCoords = editor.getScrolledVisiblePosition(selection.getEndPosition());
      if (endCoords) {
        left = (startCoords.left + endCoords.left) / 2;
        top = Math.min(startCoords.top, endCoords.top) - 10;
      }
    }

    onSelectionChange({
      text: selectedText,
      visible: true,
      top: Math.max(8, top),
      left,
      activeFormats: [],
    });
  };
}

function attachEditorListeners(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  onDocChange?: () => void,
  onSelectionChange?: (selection: SelectionOverlayState) => void,
): monaco.IDisposable[] {
  const disposables: monaco.IDisposable[] = [];
  const emitSelection = createSelectionEmitter(editor, model, onSelectionChange);

  if (onDocChange || onSelectionChange) {
    disposables.push(
      model.onDidChangeContent(() => {
        onDocChange?.();
        emitSelection();
      }),
    );
  }

  if (onSelectionChange) {
    disposables.push(editor.onDidChangeCursorSelection(() => emitSelection()));
    disposables.push(editor.onDidScrollChange(() => emitSelection()));
    emitSelection();
  }

  return disposables;
}

function setupYUndoForEditor({ yText, binding, editor, disposables }: { yText: Y.Text; binding: any; editor: monaco.editor.IStandaloneCodeEditor; disposables: monaco.IDisposable[]; }) {
  try {
    const manager = new Y.UndoManager(yText, { trackedOrigins: new Set([binding]) });
    const uniqueId = Math.random().toString(36).slice(2, 9);
    const undoAct = editor.addAction({
      id: `yjs.undo.${uniqueId}`,
      label: 'Undo (Yjs)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      run: () => {
        manager.undo();
        return;
      },
    });
    const redoAct = editor.addAction({
      id: `yjs.redo.${uniqueId}`,
      label: 'Redo (Yjs)',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
      ],
      run: () => {
        manager.redo();
        return;
      },
    });

    if (undoAct) disposables.push(undoAct as any);
    if (redoAct) disposables.push(redoAct as any);
    return manager;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Yjs UndoManager setup failed', e);
    return null;
  }
}

export function createEditor(
  container: HTMLElement,
  docId: string,
  wsUrl: string,
  onStatusChange: (status: string, cls: string) => void,
  options: CreateEditorOptions = {},
): EditorSetup {
  const {
    activeFileId,
    collaborative = true,
    initialText = '',
    isReadOnly,
    isAnonymousSession,
    initialYjsState,
    onDocChange,
    onSelectionChange,
    onPermissionDenied,
    onAccessRevoked,
    onConnectionLost,
    awarenessUser,
    onAwarenessUsersChange,
    onFileEvent,
    onConnected,
    onVersionRestored,
  } = options;
  ensureLatexLanguageRegistered();
  if (!collaborative) {
    const model = monaco.editor.createModel(initialText, LATEX_LANGUAGE_ID);
    const editor = createMonacoEditor(container, model, Boolean(isReadOnly));
    const editorDisposables = attachEditorListeners(
      editor,
      model,
      onDocChange,
      onSelectionChange,
    );
    const setReadOnly = (nextReadOnly: boolean) => {
      editor.updateOptions({ readOnly: nextReadOnly });
    };

    const saveViewState = () => {
      return editor.saveViewState();
    };

    const restoreViewState = (viewState: monaco.editor.ICodeEditorViewState | null) => {
      if (viewState) {
        editor.restoreViewState(viewState);
      }
    };

    onAwarenessUsersChange?.([], '');
    onStatusChange('Local edit', 'connected');

    const cleanup = () => {
      editorDisposables.forEach((disposable) => disposable.dispose());
      editor.dispose();
      model.dispose();
    };

    return { editor, model, setReadOnly, saveViewState, restoreViewState, cleanup };
  }

  const ydoc = new Y.Doc();
  const normalizedActiveFileId = activeFileId?.trim() ?? '';
  if (!normalizedActiveFileId) {
    console.error('Missing active file id for collaborative editor.');
  }
  const activeFileIdRef = { current: normalizedActiveFileId };

  if (initialYjsState && initialYjsState.byteLength > 0) {
    try {
      Y.applyUpdate(ydoc, initialYjsState);
    } catch {
      console.error('curruped yjs state');
    }
  }

  // Connect to the Yjs WebSocket server
  const provider = new WebsocketProvider(wsUrl, docId, ydoc);

  provider.on('status', ({ status }: { status: string }) => {
    if (status === 'connected') {
      onStatusChange('Connected', 'connected');
      onConnected?.();
    } else {
      onStatusChange('Reconnecting…', '');
    }
  });

  let requestedReadOnly = Boolean(isReadOnly);
  let isLocked = false;

  const applyReadOnly = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editor.updateOptions({ readOnly: requestedReadOnly || isLocked });
  };

  const initialYText = ydoc.getText(
    activeFileIdRef.current || 'missing-file',
  );
  let model = monaco.editor.createModel(
    initialYText.toString(),
    LATEX_LANGUAGE_ID,
  );
  const editor = createMonacoEditor(
    container,
    model,
    requestedReadOnly || isLocked,
  );
  let binding: MonacoBinding | null = new MonacoBinding(
    initialYText,
    model,
    new Set([editor]),
    provider.awareness,
  );

  let editorDisposables = attachEditorListeners(
    editor,
    model,
    onDocChange,
    onSelectionChange,
  );

  const undoManagerLocal = setupYUndoForEditor({ yText: initialYText, binding, editor, disposables: editorDisposables });

  let handledSocket: WebSocket | null = null;
  let detachSocketHandlers: (() => void) | null = null;
  let isIntentionalClose = false;
  let hasAnonymousReconnectAttempted = false;
  let anonymousReconnectTimer: number | null = null;

  const setReadOnly = (nextReadOnly: boolean) => {
    requestedReadOnly = nextReadOnly;
    applyReadOnly(editor);
  };

  const lockCollaboration = () => {
    if (isLocked) return;
    binding?.destroy();
    binding = null;
    isLocked = true;
    applyReadOnly(editor);
  };

  const unlockCollaboration = () => {
    if (!isLocked) return;
    isLocked = false;
    applyReadOnly(editor);
  };

  const installSocketHandlers = () => {
    const socket = provider.ws;
    if (!socket || socket === handledSocket) return;

    detachSocketHandlers?.();

    const messageHandler = (event: MessageEvent) => {
      // The server sends app-level control messages (permission_denied,
      // file_event) as binary frames with a leading type byte (3). y-websocket
      // silently ignores unknown types, so sync (0) and awareness (1) still
      // flow normally; we just sniff for type 3 here.
      const parsed = parseControlPayload(event.data);
      if (!parsed) return;

      const deniedMessage =
        parsed.type === 'permission_denied' && typeof parsed.message === 'string'
          ? parsed.message
          : null;
      if (deniedMessage) {
        setReadOnly(true);
        onPermissionDenied?.(deniedMessage);
        return;
      }

      if (parsed.type === 'file_event') {
        onFileEvent?.(parsed as FileEventMessage);
      }
    };

    const closeHandler = (event: CloseEvent) => {
      if (event.reason === 'version_restored') {
        onVersionRestored?.();
        if (!isIntentionalClose) {
          provider.connect();
        }
        return;
      }

      if (isIntentionalClose || event.code === 1000) {
        return;
      }

      if (event.code === 1008) {
        setReadOnly(true);
        onAccessRevoked?.();
        return;
      }

      if (!isAnonymousSession) {
        return;
      }

      if (hasAnonymousReconnectAttempted) {
        setReadOnly(true);
        onConnectionLost?.();
        return;
      }

      hasAnonymousReconnectAttempted = true;
      provider.connect();

      if (anonymousReconnectTimer) {
        window.clearTimeout(anonymousReconnectTimer);
      }

      anonymousReconnectTimer = window.setTimeout(() => {
        const wsConnected = (provider as { wsconnected?: boolean }).wsconnected;
        if (wsConnected) {
          return;
        }

        setReadOnly(true);
        onConnectionLost?.();
      }, 2500);
    };

    socket.addEventListener('message', messageHandler);
    socket.addEventListener('close', closeHandler);
    handledSocket = socket;
    detachSocketHandlers = () => {
      socket.removeEventListener('message', messageHandler);
      socket.removeEventListener('close', closeHandler);
    };
  };

  provider.on('status', ({ status }: { status: string }) => {
    if (status === 'connected') {
      if (anonymousReconnectTimer) {
        window.clearTimeout(anonymousReconnectTimer);
        anonymousReconnectTimer = null;
      }

      if (isAnonymousSession) {
        hasAnonymousReconnectAttempted = false;
      }

      installSocketHandlers();
    }
  });

  installSocketHandlers();

  // Set awareness (shows your cursor to others)
  const awarenessName =
    awarenessUser?.displayName?.trim() ||
    awarenessUser?.email?.trim() ||
    'Anonymous';
  const colorSeed = awarenessUser?.id || awarenessUser?.email || awarenessName;

  provider.awareness.setLocalStateField('user', {
    name: awarenessName,
    color: getDeterministicColor(colorSeed, 1),
    colorLight: getDeterministicColor(colorSeed, 0.25),
  });
  if (activeFileIdRef.current) {
    provider.awareness.setLocalStateField('activeFile', activeFileIdRef.current);
  }

  const awareness = provider.awareness;
  const awarenessStyleElement = document.createElement('style');
  awarenessStyleElement.setAttribute(
    'data-yjs-awareness-style',
    `${docId}-${ydoc.clientID}`,
  );
  document.head.appendChild(awarenessStyleElement);

  const renderAwarenessStyles = () => {
    const rules: string[] = [];
    const activeFile = activeFileIdRef.current;

    awareness.getStates().forEach((state, clientId) => {
      if (clientId === ydoc.clientID) return;

      const scopedState = state as {
        activeFile?: string;
        user?: { name?: string; color?: string; colorLight?: string };
      };
      if (!activeFile || scopedState.activeFile !== activeFile) return;

      const rawUser = scopedState.user;
      if (!rawUser) return;

      const name = rawUser.name?.trim() || 'Anonymous';
      const color = rawUser.color || '#30bced';
      const colorLight =
        rawUser.colorLight || getDeterministicColor(name, 0.25);
      const safeName = escapeCssContent(name);

      rules.push(
        `.monaco-editor .yRemoteSelection-${clientId} { background-color: ${colorLight}; border-left: 2px solid ${color}; }`,
      );
      rules.push(
        `.monaco-editor .yRemoteSelectionHead-${clientId} { position: relative; border-left: 2px solid ${color}; }`,
      );
      rules.push(
        `.monaco-editor .yRemoteSelectionHead-${clientId}::after { content: "${safeName}"; position: absolute; left: 0; top: -1.45rem; background: ${color}; color: #ffffff; font-size: 11px; line-height: 1; padding: 3px 6px; border-radius: 9999px; white-space: nowrap; }`,
      );
    });

    awarenessStyleElement.textContent = rules.join('\n');
  };

  awareness.on('change', renderAwarenessStyles);
  awareness.on('update', renderAwarenessStyles);
  renderAwarenessStyles();

  const emitAwarenessUsers = () => {
    if (!onAwarenessUsersChange) {
      return;
    }

    const localClientId = awareness.doc.clientID;
    const activeFile = activeFileIdRef.current;
    const now = Date.now();
    const users: AwarenessPresenceUser[] = [];

    awareness.getStates().forEach((state, clientId) => {
      const scopedState = state as {
        activeFile?: string;
        user?: { name?: string; color?: string };
      };
      if (!activeFile || scopedState.activeFile !== activeFile) {
        return;
      }

      const isLocalClient = clientId === localClientId;
      const meta = awareness.meta.get(clientId);
      if (
        !isLocalClient &&
        meta &&
        now - meta.lastUpdated > AWARENESS_STALE_MS
      ) {
        return;
      }

      const rawUser = scopedState.user;
      if (!rawUser) {
        return;
      }

      const name = rawUser?.name?.trim() || 'Anonymous';
      const color = rawUser?.color || '#30bced';

      users.push({ clientId, name, color });
    });

    users.sort((a, b) => {
      if (a.clientId === localClientId) return -1;
      if (b.clientId === localClientId) return 1;
      return a.name.localeCompare(b.name);
    });

    if (activeFile) {
      onAwarenessUsersChange(users, activeFile);
    }
  };

  if (onAwarenessUsersChange) {
    const awarenessInterval = window.setInterval(
      emitAwarenessUsers,
      AWARENESS_POLL_MS,
    );
    const cleanupAwarenessUsers = () => {
      awareness.off('change', emitAwarenessUsers);
      awareness.off('update', emitAwarenessUsers);
      window.clearInterval(awarenessInterval);
    };

    awareness.on('change', emitAwarenessUsers);
    awareness.on('update', emitAwarenessUsers);
    emitAwarenessUsers();

    const cleanup = () => {
      isIntentionalClose = true;
      if (anonymousReconnectTimer) {
        window.clearTimeout(anonymousReconnectTimer);
        anonymousReconnectTimer = null;
      }
      detachSocketHandlers?.();
      cleanupAwarenessUsers();
      awareness.off('change', renderAwarenessStyles);
      awareness.off('update', renderAwarenessStyles);
      awarenessStyleElement.remove();
      editorDisposables.forEach((disposable) => disposable.dispose());
      binding?.destroy();
      provider.destroy();
      editor.dispose();
      model.dispose();
    };

    const setActiveFileId = (nextFileId: string) => {
      const trimmed = nextFileId.trim();
      if (!trimmed || trimmed === activeFileIdRef.current) {
        return;
      }

      activeFileIdRef.current = trimmed;
      unlockCollaboration();
      binding?.destroy();
      binding = null;
      editorDisposables.forEach((disposable) => disposable.dispose());
      model.dispose();

      const nextYText = ydoc.getText(trimmed);
      const nextModel = monaco.editor.createModel(
        nextYText.toString(),
        LATEX_LANGUAGE_ID,
      );
      editor.setModel(nextModel);
      model = nextModel;
      binding = new MonacoBinding(
        nextYText,
        nextModel,
        new Set([editor]),
        provider.awareness,
      );
      editorDisposables = attachEditorListeners(
        editor,
        nextModel,
        onDocChange,
        onSelectionChange,
      );

      setupYUndoForEditor({ yText: nextYText, binding, editor, disposables: editorDisposables });

      provider.awareness.setLocalStateField('activeFile', trimmed);
      renderAwarenessStyles();
      emitAwarenessUsers();
    };

    return {
      editor,
      model,
      provider,
      ydoc,
      binding,
      setReadOnly,
      setActiveFileId,
      lockCollaboration,
      unlockCollaboration,
      cleanup,
    };
  }

  const setActiveFileId = (nextFileId: string) => {
    const trimmed = nextFileId.trim();
    if (!trimmed || trimmed === activeFileIdRef.current) {
      return;
    }

    activeFileIdRef.current = trimmed;
    unlockCollaboration();
    binding?.destroy();
    binding = null;
    editorDisposables.forEach((disposable) => disposable.dispose());
    model.dispose();

    const nextYText = ydoc.getText(trimmed);
    const nextModel = monaco.editor.createModel(
      nextYText.toString(),
      LATEX_LANGUAGE_ID,
    );
    editor.setModel(nextModel);
    model = nextModel;
    binding = new MonacoBinding(
      nextYText,
      nextModel,
      new Set([editor]),
      provider.awareness,
    );
    editorDisposables = attachEditorListeners(
      editor,
      nextModel,
      onDocChange,
      onSelectionChange,
    );

    setupYUndoForEditor({ yText: nextYText, binding, editor, disposables: editorDisposables });

    provider.awareness.setLocalStateField('activeFile', trimmed);
    renderAwarenessStyles();
  };

  const cleanup = () => {
    isIntentionalClose = true;
    if (anonymousReconnectTimer) {
      window.clearTimeout(anonymousReconnectTimer);
      anonymousReconnectTimer = null;
    }
    detachSocketHandlers?.();
    awareness.off('change', renderAwarenessStyles);
    awareness.off('update', renderAwarenessStyles);
    awarenessStyleElement.remove();
    editorDisposables.forEach((disposable) => disposable.dispose());
    binding?.destroy();
    provider.destroy();
    editor.dispose();
    model.dispose();
  };

  const saveViewState = () => {
    return editor.saveViewState();
  };

  const restoreViewState = (viewState: monaco.editor.ICodeEditorViewState | null) => {
    if (viewState) {
      editor.restoreViewState(viewState);
    }
  };

  return {
    editor,
    model,
    provider,
    ydoc,
    binding,
    setReadOnly,
    setActiveFileId,
    lockCollaboration,
    unlockCollaboration,
    saveViewState,
    restoreViewState,
    cleanup,
  };
}

/**
 * Insert a snippet at the current cursor position.
 * Moves the cursor inside {} if the snippet ends with {}.
 */
export function insertSnippet(
  editor: monaco.editor.IStandaloneCodeEditor,
  snippet: string,
  insertPos?: monaco.IPosition,
): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model) return;

  const fallbackPosition =
    selection?.getStartPosition() ?? editor.getPosition();
  if (!fallbackPosition) return;

  const targetPosition = insertPos ?? fallbackPosition;

  const from = model.getOffsetAt(targetPosition);

  const braceIndex = snippet.indexOf('{}');
  const closingBraceIndex = snippet.indexOf('}');
  const doubleSpaceIndex = snippet.indexOf('  ');

  let cursorOffset = snippet.length;
  if (braceIndex >= 0) {
    cursorOffset = braceIndex + 1;
  } else if (doubleSpaceIndex >= 0) {
    cursorOffset = doubleSpaceIndex + 1;
  } else if (closingBraceIndex > 0) {
    cursorOffset = closingBraceIndex;
  }

  editor.executeEdits('snippet', [
    {
      range: new monaco.Range(
        targetPosition.lineNumber,
        targetPosition.column,
        targetPosition.lineNumber,
        targetPosition.column,
      ),
      text: snippet,
      forceMoveMarkers: true,
    },
  ]);

  const cursorPos = model.getPositionAt(from + cursorOffset);
  editor.setPosition(cursorPos);
  editor.focus();
}
