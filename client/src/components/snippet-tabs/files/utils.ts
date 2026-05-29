import type { FileTreeNode } from './fileTree';
import {
  categoryForFilename,
  normalizeFileCategory,
} from '@/utils/fileCategories';
import { getApiErrorMessage as getApiErrorMessageShared } from '@/utils/apiError';

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'tif',
  'tiff',
]);

const LATEX_TEXT_EXTENSIONS = new Set([
  'tex',
  'bib',
  'sty',
  'cls',
  'tikz',
  'pgf',
  'cfg',
  'txt',
]);

// Re-export the centralized helper so callers in this file's neighborhood
// don't need to update their imports. See `@/utils/apiError` for the canonical
// definition that also handles openapi-ts's `body`-wrapped shape.
export const getApiErrorMessage = getApiErrorMessageShared;

export function formatBytes(size?: number | null): string {
  if (typeof size !== 'number' || Number.isNaN(size)) {
    return '—';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileExtension(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0 || idx === path.length - 1) return '';
  return path.slice(idx + 1).toLowerCase();
}

export function isImageNode(node: FileTreeNode): boolean {
  const category = normalizeFileCategory(node.category ?? null);
  if (category !== 'unknown') {
    return category === 'image';
  }
  if (node.contentType?.toLowerCase().startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(getFileExtension(node.fullPath));
}

export function isLatexTextNode(node: FileTreeNode): boolean {
  const extension = getFileExtension(node.fullPath);
  if (LATEX_TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  const category = normalizeFileCategory(node.category ?? null);
  if (category !== 'unknown') {
    return category === 'collaborative';
  }
  return categoryForFilename(node.fullPath) === 'collaborative';
}
