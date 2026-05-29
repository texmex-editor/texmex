import { createEditorService, type EditorInstance } from '@/lib/editorService';
import { ensureLatexPackagesInEditor } from '@/lib/latexPackageEditor';
import type { IPosition } from 'monaco-editor';
import type { LatexPackageName } from '@/lib/latexPackages';

export type SnippetInsertion = {
  text: string;
  requiredPackages?: LatexPackageName[];
};

type SerializedSnippetInsertion = SnippetInsertion & {
  type: 'snippet-insertion';
};

export function serializeSnippetInsertion(
  insertion: SnippetInsertion,
): string {
  return JSON.stringify({
    type: 'snippet-insertion',
    text: insertion.text,
    requiredPackages: insertion.requiredPackages ?? [],
  } satisfies SerializedSnippetInsertion);
}

export function parseSnippetInsertion(
  payload: string,
): SnippetInsertion | null {
  try {
    const parsed = JSON.parse(payload) as Partial<SerializedSnippetInsertion>;
    if (parsed?.type !== 'snippet-insertion' || typeof parsed.text !== 'string') {
      return null;
    }

    const requiredPackages = Array.isArray(parsed.requiredPackages)
      ? parsed.requiredPackages.filter(
          (packageName): packageName is LatexPackageName =>
            typeof packageName === 'string' && packageName.trim().length > 0,
        )
      : [];

    return {
      text: parsed.text,
      requiredPackages,
    };
  } catch {
    return null;
  }
}

import { applySnippetInsertion as applySnippetInsertionImpl } from '@/snippets/snippetManager';

export function applySnippetInsertion(
  packageEditor: EditorInstance | null | undefined,
  targetEditor: EditorInstance,
  insertion: SnippetInsertion,
  position?: IPosition,
): void {
  return applySnippetInsertionImpl(packageEditor as any, targetEditor as any, insertion as any, position as any);
}
