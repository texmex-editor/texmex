import type { FileResponse } from '@/client';
import {
  categoryForFilename,
  isCategoryTextEditable,
  normalizeFileCategory,
  type FileCategory,
} from '@/utils/fileCategories';

export type FileTreeNode = {
  name: string;
  fullPath: string;
  type: 'file' | 'folder';
  fileId?: string;
  contentType?: string | null;
  size?: number;
  category?: FileCategory;
  isCollaborative?: boolean;
  children?: FileTreeNode[];
};

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  const sorted = [...nodes].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'folder' ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });

  return sorted.map((node) =>
    node.type === 'folder' && node.children
      ? { ...node, children: sortNodes(node.children) }
      : node,
  );
}

// Inject empty placeholder folder nodes for paths that don't exist in the tree
// yet. Used to surface "ephemeral" folders the user just created via the
// New-folder dialog — they don't exist as filename prefixes in the DB until a
// file is placed inside, so without this they'd be invisible in the tree.
// Re-sorts at each level so the new folder lands alphabetically among siblings.
export function mergeEphemeralFolders(
  tree: FileTreeNode[],
  folderPaths: Iterable<string>,
): FileTreeNode[] {
  const root = [...tree];
  for (const path of folderPaths) {
    if (!path) continue;
    const parts = path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i];
      const fullPath = parts.slice(0, i + 1).join('/');
      let folder = current.find(
        (node) => node.type === 'folder' && node.name === name,
      );
      if (!folder) {
        folder = { name, fullPath, type: 'folder', children: [] };
        current.push(folder);
      } else if (!folder.children) {
        folder.children = [];
      }
      current = folder.children!;
    }
  }
  // Walk and re-sort every level. Simpler than threading sorting through the
  // injection loop above.
  const resort = (nodes: FileTreeNode[]): FileTreeNode[] => {
    const sorted = sortNodes(nodes);
    for (const node of sorted) {
      if (node.children) node.children = resort(node.children);
    }
    return sorted;
  };
  return resort(root);
}

export function buildFileTree(files: FileResponse[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const filename = (file.filename ?? '').trim();
    const fileId = (file.id ?? '').trim();
    if (!filename || !fileId) {
      continue;
    }

    const category = normalizeFileCategory(file.category ?? null);

    const parts = filename.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      if (isFile) {
        current.push({
          name,
          fullPath,
          type: 'file',
          fileId,
          contentType: file.contentType ?? null,
          size: typeof file.size === 'number' ? file.size : undefined,
          category,
          isCollaborative: file.isCollaborative,
        });
      } else {
        let folder = current.find(
          (node) => node.type === 'folder' && node.name === name,
        );
        if (!folder) {
          folder = {
            name,
            fullPath,
            type: 'folder',
            children: [],
          };
          current.push(folder);
        }

        current = folder.children ?? [];
        if (!folder.children) {
          folder.children = current;
        }
      }
    }
  }

  return sortNodes(root);
}

export function flattenFiles(tree: FileTreeNode[]): FileTreeNode[] {
  const files: FileTreeNode[] = [];

  const walk = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'file') {
        files.push(node);
      } else if (node.children) {
        walk(node.children);
      }
    }
  };

  walk(tree);
  return files;
}

export function collectFilesByPrefix(
  files: FileTreeNode[],
  folderPrefix: string,
): FileTreeNode[] {
  const normalizedPrefix = folderPrefix.endsWith('/')
    ? folderPrefix
    : `${folderPrefix}/`;

  return files.filter((file) => file.fullPath.startsWith(normalizedPrefix));
}

export function validateFilename(
  filename: string,
  entrypoint = 'main.tex',
): string | null {
  const value = filename.trim();

  if (!value) return 'Filename is required.';
  if (value.length > 255) return 'Filename too long (max 255 characters).';
  if (/[^\x20-\x7E]/.test(value)) return 'ASCII characters only.';
  if (value.includes('\\')) return 'Use forward slashes for paths.';
  if (value.includes('%')) return 'No percent-encoded characters.';
  if (value.startsWith('/') || value.endsWith('/')) {
    return 'No leading or trailing slashes.';
  }
  if (value.includes('//')) return 'No empty path segments.';
  if (/[\x00-\x1F\x7F]/.test(value)) return 'No control characters allowed.';

  const segments = value.split('/');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return 'No . or .. segments.';
    if (segment.startsWith('.')) return 'Segments cannot start with a dot.';
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      return 'Segments cannot end with a dot or space.';
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._\- ]*$/.test(segment)) {
      return 'Invalid characters in filename.';
    }
  }

  if (value.toLowerCase() === entrypoint.toLowerCase()) {
    return `"${entrypoint}" is reserved for the main editor document.`;
  }

  return null;
}

export function isTextEditableFile(file: {
  filename?: string | null;
  contentType?: string | null;
  category?: string | null;
  isCollaborative?: boolean;
}): boolean {
  const normalizedCategory = normalizeFileCategory(file.category ?? null);
  if (normalizedCategory !== 'unknown') {
    return isCategoryTextEditable(normalizedCategory);
  }

  const fallbackCategory = categoryForFilename((file.filename ?? '').trim());
  return isCategoryTextEditable(fallbackCategory);
}
