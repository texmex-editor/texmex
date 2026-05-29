export type FileCategory =
  | 'collaborative'
  | 'static_text'
  | 'image'
  | 'pdf'
  | 'font'
  | 'unknown';

export const COLLABORATIVE_EXTENSIONS = [
  '.tex',
  '.bib',
  '.cls',
  '.sty',
  '.tikz',
  '.pgf',
  '.cfg',
  '.txt',
];

export const STATIC_TEXT_EXTENSIONS = [
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.log',
];

export const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.tif',
  '.tiff',
  '.svg',
];

export const PDF_EXTENSIONS = ['.pdf'];

export const FONT_EXTENSIONS = ['.ttf', '.otf'];

export const ACCEPTED_FILE_EXTENSIONS = [
  ...COLLABORATIVE_EXTENSIONS,
  ...STATIC_TEXT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...FONT_EXTENSIONS,
];

export function normalizeFileCategory(
  category?: string | null,
): FileCategory {
  switch (category) {
    case 'collaborative':
    case 'static_text':
    case 'image':
    case 'pdf':
    case 'font':
      return category;
    case 'unknown':
      return 'unknown';
    default:
      return 'unknown';
  }
}

export function isCollaborativeCategory(
  category: FileCategory,
  isCollaborative?: boolean,
): boolean {
  if (typeof isCollaborative === 'boolean') {
    return isCollaborative;
  }
  return category === 'collaborative';
}

export function isCategoryTextEditable(category: FileCategory): boolean {
  return category === 'collaborative' || category === 'static_text';
}

export function isCategoryPreviewImage(category: FileCategory): boolean {
  return category === 'image';
}

export function isCategoryPreviewPdf(category: FileCategory): boolean {
  return category === 'pdf';
}

export function isCategoryDownloadOnly(category: FileCategory): boolean {
  return category === 'font' || category === 'unknown';
}

export function isCollaborativeFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return COLLABORATIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function categoryForFilename(filename: string): FileCategory {
  const lower = filename.toLowerCase();
  if (COLLABORATIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'collaborative';
  }
  if (STATIC_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'static_text';
  }
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'image';
  }
  if (PDF_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'pdf';
  }
  if (FONT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'font';
  }
  return 'unknown';
}
