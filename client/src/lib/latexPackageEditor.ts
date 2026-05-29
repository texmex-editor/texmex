import * as monaco from 'monaco-editor';
import type { LatexPackageName } from './latexPackages';

export function collectLatexPackageNames(source: string): string[] {
  const matches = source.matchAll(/\\usepackage(?:\[[^\]]*])?\{([^}]*)\}/g);
  const packages: string[] = [];
  for (const match of matches) {
    const list = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    packages.push(...list);
  }
  return packages;
}

export function hasLatexPackage(
  source: string,
  packageName: LatexPackageName,
): boolean {
  const normalized = packageName.trim();
  if (!normalized) return false;
  const packages = collectLatexPackageNames(source);
  return packages.some((name) => name === normalized);
}

export function ensureLatexPackagesInEditor(
  editor: monaco.editor.IStandaloneCodeEditor,
  packageNames: LatexPackageName[],
): boolean {
  const model = editor.getModel();
  if (!model) return false;

  const source = model.getValue();
  const normalizedNames = packageNames.map((name) => name.trim()).filter(Boolean);
  const uniqueNames = Array.from(new Set(normalizedNames));
  const missing = uniqueNames.filter((name) => !hasLatexPackage(source, name));
  if (missing.length === 0) return false;

  const documentClassMatch = /\\documentclass(?:\[[^\]]*])?\{[^}]+}/.exec(source);
  const insertOffset = documentClassMatch
    ? documentClassMatch.index + documentClassMatch[0].length
    : 0;
  const insertPosition = model.getPositionAt(insertOffset);
  const packageLines = missing.map((name) => `\\usepackage{${name}}`).join('\n');
  const textToInsert =
    insertOffset === 0 ? `${packageLines}\n` : `\n${packageLines}`;

  editor.executeEdits('latex.ensure-packages', [
    {
      range: new monaco.Range(
        insertPosition.lineNumber,
        insertPosition.column,
        insertPosition.lineNumber,
        insertPosition.column,
      ),
      text: textToInsert,
      forceMoveMarkers: true,
    },
  ]);

  return true;
}
