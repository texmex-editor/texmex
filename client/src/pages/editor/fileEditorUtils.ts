import type { FileCategory } from '@/utils/fileCategories';

export const BASIC_LATEX_TEMPLATE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}

\\begin{document}
Hello, TexMex!
\\end{document}
`;

export type OpenEditorFile = {
  key: string;
  fileId: string;
  filename: string;
  contentType: string | null;
  isTextEditable: boolean;
  category: FileCategory;
  isCollaborative: boolean;
  initialText: string | null;
};

// Sentinel tab key for the main entrypoint editor. Distinct from any
// per-file key (those go through `createFileEditorKey` and are prefixed
// with "file:"), so `activeEditorTabKey === MAIN_TAB_KEY` reliably means
// "the main editor tab is active" with no false match against a file id.
export const MAIN_TAB_KEY = 'main';

export function createFileEditorKey(fileId: string): string {
  return `file:${fileId}`;
}

export function isPreviewableImageFile(file: {
  filename: string;
  contentType: string | null;
}): boolean {
  const contentType = (file.contentType ?? '').toLowerCase();
  if (contentType.startsWith('image/')) {
    return true;
  }

  const lower = file.filename.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.bmp')
  );
}

export function sanitizeFilenameSegment(segment: string): string {
  const ascii = segment
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._\-]+/g, '_')
    .trim();
  const cleaned = ascii
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[.\- ]+$/, '')
    .replace(/-+/g, '-');
  return cleaned || 'image';
}

export function inferImageExtension(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/gif':
      return '.gif';
    case 'image/svg+xml':
      return '.svg';
    case 'image/webp':
      return '.webp';
    case 'image/bmp':
      return '.bmp';
    case 'image/tiff':
    case 'image/tif':
      return '.tif';
    default:
      return '';
  }
}

export function isSupportedLatexImage(file: File): boolean {
  const contentType = file.type.toLowerCase();
  if (
    contentType === 'image/png' ||
    contentType === 'image/jpeg' ||
    contentType === 'image/jpg'
  ) {
    return true;
  }

  const lowerName = (file.name ?? '').toLowerCase();
  return (
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg')
  );
}

export function splitFilename(path: string): {
  stem: string;
  extension: string;
} {
  const slashIdx = path.lastIndexOf('/');
  const base = slashIdx >= 0 ? path.slice(slashIdx + 1) : path;
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0) {
    return { stem: base, extension: '' };
  }
  return {
    stem: base.slice(0, dotIdx),
    extension: base.slice(dotIdx),
  };
}

function createCaptionFromPath(path: string): string {
  const { stem } = splitFilename(path);
  const normalized = stem
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-zA-Z0-9. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return 'Image';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function buildImageFigureSnippet(path: string): string {
  const caption = createCaptionFromPath(path);
  return `\\begin{figure}[ht]
  \\centering
  \\includegraphics[width=0.7\\linewidth]{${path}}
  \\caption{${caption}}
\\end{figure}`;
}

export function buildUniquePath(path: string, existing: Set<string>): string {
  if (!existing.has(path.toLowerCase())) {
    existing.add(path.toLowerCase());
    return path;
  }

  const slashIdx = path.lastIndexOf('/');
  const prefix = slashIdx >= 0 ? `${path.slice(0, slashIdx + 1)}` : '';
  const { stem, extension } = splitFilename(path);
  let counter = 1;
  let candidate = `${prefix}${stem}-${counter}${extension}`;
  while (existing.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `${prefix}${stem}-${counter}${extension}`;
  }

  existing.add(candidate.toLowerCase());
  return candidate;
}
