import { toast } from 'sonner';
import type { DocumentFilesAdapter, NotificationAdapter } from './editorSession';
import { getApiDocumentsByIdFiles, postApiDocumentsByIdFiles } from '@/client';
import { createEditorService } from '@/lib/editorService';

export function createNotificationAdapter(): NotificationAdapter {
  return {
    info: (msg: string) => toast(msg),
    success: (msg: string) => toast.success(msg),
    error: (msg: string) => toast.error(msg),
  };
}

export function createDocumentFilesAdapter(): DocumentFilesAdapter {
  return {
    listFiles: async (id: string) => {
      try {
        const resp = await getApiDocumentsByIdFiles({ path: { id }, throwOnError: true });
        return resp.data ?? [];
      } catch (err) {
        console.error('createDocumentFilesAdapter.listFiles error', err);
        return [];
      }
    },
    uploadFile: async (id: string, file: File, filename: string) => {
      try {
        // The generated client supports form-data via formDataBodySerializer and
        // expects body: { file: File }
        await postApiDocumentsByIdFiles({ path: { id }, body: { file }, throwOnError: true });
      } catch (err) {
        console.error('createDocumentFilesAdapter.uploadFile error', err);
        throw err;
      }
    },
  };
}

// Lightweight editor adapter helpers. These are convenience wrappers that use
// the existing createEditorService at call-time so they don't need to hold
// onto editor instances themselves.
export function createEditorAdapter() {
  return {
    ensureLatexPackage: (editor: any, pkg: string) => {
      try {
        // lazy-create service
        createEditorService(editor).ensureLatexPackage(pkg);
      } catch (err) {
        console.warn('ensureLatexPackage failed', err);
      }
    },
    getDropPosition: (editor: any, clientX: number, clientY: number) => {
      try {
        return createEditorService(editor).getDropPosition(clientX, clientY);
      } catch (err) {
        return null;
      }
    },
    setPosition: (editor: any, position: any) => {
      try {
        createEditorService(editor).setPosition(position);
      } catch (err) {
        console.warn('setPosition failed', err);
      }
    },
    insertSnippet: (editor: any, snippet: string, position: any) => {
      try {
        createEditorService(editor).insertSnippet(snippet, position);
      } catch (err) {
        console.warn('insertSnippet failed', err);
      }
    },
    replaceFormula: (editor: any, formula: any, nextBody: string) => {
      try {
        createEditorService(editor).replaceFormula(formula, nextBody);
      } catch (err) {
        console.warn('replaceFormula failed', err);
      }
    },
    wrapSelection: (editor: any, before: string, after: string) => {
      try {
        createEditorService(editor).wrapSelection(before, after);
      } catch (err) {
        console.warn('wrapSelection failed', err);
      }
    },
    unwrapSelection: (editor: any, before: string, after: string) => {
      try {
        createEditorService(editor).unwrapSelection(before, after);
      } catch (err) {
        console.warn('unwrapSelection failed', err);
      }
    },
    replaceAllContent: (editor: any, tag: string, content: string) => {
      try {
        return createEditorService(editor).replaceAllContent(tag, content);
      } catch (err) {
        console.warn('replaceAllContent failed', err);
        return false;
      }
    },
    getValue: (editor: any) => {
      try {
        return createEditorService(editor).getValue();
      } catch (err) {
        console.warn('getValue failed', err);
        return '';
      }
    },
  };
}

// Basic collaboration adapter stub — implement project-specific logic later.
export function createCollaborationAdapter() {
  return {
    // noop: register callbacks or forward to yjs/y-websocket in a future pass
    onAwarenessChange: (cb: (users: any[]) => void) => {
      // no-op for now
      return () => {};
    },
    sendFileEvent: (_event: unknown) => {
      // no-op
    },
  };
}
