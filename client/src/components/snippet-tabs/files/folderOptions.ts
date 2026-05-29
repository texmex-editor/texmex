// Folder-picker option type + builder. Extracted out of FilesDialogs.tsx so
// that file can only-export components (Vite Fast Refresh + react-doctor:
// only-export-components). NewFile / Move dialogs and FilesTab all import
// from here.

export type FolderOption = {
  /** Empty string for the document root, otherwise the folder path without
   *  trailing slash (e.g. "src" or "src/sub"). */
  value: string;
  /** Display label for the dropdown — "(root)" for empty, "src/" for nested. */
  label: string;
};

export function buildFolderOptions(folders: Iterable<string>): FolderOption[] {
  const sorted = [...new Set(folders)]
    .filter((f) => f.length > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [
    { value: '', label: '(root)' },
    ...sorted.map((f) => ({ value: f, label: `${f}/` })),
  ];
}
