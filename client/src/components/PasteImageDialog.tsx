import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderPlus, Loader2 } from 'lucide-react';
import { buildFolderOptions, type FolderOption } from '@/components/snippet-tabs/files/folderOptions';
import { NewFolderDialog } from '@/components/snippet-tabs/files/FilesDialogs';

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

type PasteImageDialogProps = {
  open: boolean;
  busy: boolean;
  imageFile: File | null;
  existingFiles: { filename?: string | null }[];
  onSubmit: (folder: string, filename: string) => Promise<void>;
  onClose: () => void;
};

export const PasteImageDialog: React.FC<PasteImageDialogProps> = ({
  open,
  busy,
  imageFile,
  existingFiles,
  onSubmit,
  onClose,
}) => {
  const [folder, setFolder] = useState('');
  const [filename, setFilename] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  // Compute folder options based on existing files + local/ephemeral folders
  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const file of existingFiles) {
      const path = (file.filename ?? '').trim();
      if (!path) continue;
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join('/'));
      }
    }
    for (const f of localFolders) {
      set.add(f);
    }
    return buildFolderOptions(set);
  }, [existingFiles, localFolders]);

  const existingFolderSet = useMemo(() => {
    const set = new Set<string>();
    for (const file of existingFiles) {
      const path = (file.filename ?? '').trim();
      if (!path) continue;
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join('/'));
      }
    }
    for (const f of localFolders) {
      set.add(f);
    }
    return set;
  }, [existingFiles, localFolders]);

  useEffect(() => {
    if (open && imageFile) {
      const url = URL.createObjectURL(imageFile);
      setPreviewUrl(url);

      // Guess extension
      let ext = '.png';
      if (imageFile.type === 'image/jpeg' || imageFile.type === 'image/jpg') {
        ext = '.jpg';
      } else if (imageFile.type === 'image/webp') {
        ext = '.webp';
      }

      // Default folder: select 'images' if it exists, otherwise root
      const hasImagesFolder = folderOptions.some((opt) => opt.value === 'images');
      const defaultFolder = hasImagesFolder ? 'images' : '';
      setFolder(defaultFolder);

      // Generate a unique default filename like clipboard-image.png, clipboard-image-1.png, etc.
      let baseName = 'clipboard-image';
      let candidate = `${baseName}${ext}`;
      let counter = 1;
      const isTaken = (name: string) => {
        return existingFiles.some(
          (f) => (f.filename ?? '').toLowerCase() === name.toLowerCase(),
        );
      };

      const getFullPath = (fld: string, name: string) =>
        fld ? `${fld}/${name}` : name;

      while (isTaken(getFullPath(defaultFolder, candidate))) {
        candidate = `${baseName}-${counter}${ext}`;
        counter++;
      }

      setFilename(candidate);
      setError(null);

      return () => {
        URL.revokeObjectURL(url);
        setPreviewUrl(null);
      };
    }
  }, [open, imageFile, folderOptions, existingFiles]);

  const handleCreateFolder = async (folderPath: string) => {
    setLocalFolders((prev) => [...prev, folderPath]);
    setFolder(folderPath);
    setNewFolderOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = filename.trim();
    if (!trimmed) {
      setError('Filename is required.');
      return;
    }
    if (trimmed.includes('/')) {
      setError('Filename cannot contain "/". Use the folder dropdown instead.');
      return;
    }

    const lowerName = trimmed.toLowerCase();
    if (
      !lowerName.endsWith('.png') &&
      !lowerName.endsWith('.jpg') &&
      !lowerName.endsWith('.jpeg')
    ) {
      setError('Only PNG and JPEG/JPG image extensions are supported for LaTeX compilation.');
      return;
    }

    const fullPath = folder ? `${folder}/${trimmed}` : trimmed;
    const exists = existingFiles.some(
      (f) => (f.filename ?? '').toLowerCase() === fullPath.toLowerCase(),
    );
    if (exists) {
      setError(`A file named "${fullPath}" already exists. Pick a different name.`);
      return;
    }

    setError(null);
    try {
      await onSubmit(folder, trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload image.');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Insert Image from Clipboard</DialogTitle>
            <DialogDescription>
              You have an image in your clipboard. Choose where to save it in your project.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {previewUrl && (
              <div className="flex flex-col items-center justify-center p-4 border border-dashed rounded-xl bg-muted/30">
                <div className="text-xs text-muted-foreground mb-2">Image Preview</div>
                <img
                  src={previewUrl}
                  alt="Clipboard paste"
                  className="max-h-48 rounded-lg object-contain shadow-soft border bg-background"
                />
                <div className="text-[10px] text-muted-foreground mt-2">
                  {(imageFile?.size ?? 0) > 0
                    ? `${(imageFile!.size / 1024).toFixed(1)} KB - ${imageFile!.type}`
                    : ''}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Destination Folder
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    className={SELECT_CLASS}
                    disabled={busy}
                  >
                    {folderOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setNewFolderOpen(true)}
                    disabled={busy}
                  >
                    <FolderPlus className="size-3.5" />
                    Folder
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Filename
                </label>
                <Input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  maxLength={255}
                  disabled={busy}
                  placeholder="image.png"
                />
              </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="size-3.5 animate-spin mr-2" />}
                Apply & Insert
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <NewFolderDialog
        open={newFolderOpen}
        busy={busy}
        existingFolders={existingFolderSet}
        onSubmit={handleCreateFolder}
        onClose={() => setNewFolderOpen(false)}
      />
    </>
  );
};
