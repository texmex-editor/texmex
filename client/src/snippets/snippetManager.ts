import { createEditorService } from '@/lib/editorService';
import { ensureLatexPackagesInEditor } from '@/lib/latexPackageEditor';
import type { IPosition } from 'monaco-editor';
import type { LatexPackageName } from '@/lib/latexPackages';

export type SnippetInsertion = {
  text: string;
  requiredPackages?: LatexPackageName[];
};

export function applySnippetInsertion(
  packageEditor: any | null | undefined,
  targetEditor: any,
  insertion: SnippetInsertion,
  position?: IPosition,
): void {
  if (packageEditor) {
    ensureLatexPackagesInEditor(
      packageEditor,
      insertion.requiredPackages ?? [],
    );
  }

  createEditorService(targetEditor).insertSnippet(insertion.text, position);
}
