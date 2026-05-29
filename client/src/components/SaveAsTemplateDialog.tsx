import {
  getApiDocumentsByIdFilesOptions,
  getApiTemplatesQueryKey,
  postApiDocumentsByIdSaveAsTemplateMutation,
} from '@/client/@tanstack/react-query.gen';
import { Badge } from '@/components/ui/badge';
import { formatBytes } from '@/components/snippet-tabs/files/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/utils/apiError';
import {
  TEMPLATE_CATEGORIES,
  formatCategoryLabel,
} from '@/utils/templateCategories';

type SaveAsTemplateDialogProps = {
  docId: string;
  hasApiDocumentId: boolean;
  canSaveTemplate: boolean;
  /**
   * Custom trigger element to replace the default button. Useful when the
   * dialog opens from a dropdown menu item rather than a standalone button.
   * Must be a single React element that accepts onClick (DialogTrigger asChild
   * forwards events into it).
   *
   * Ignored when `open` is controlled — use the controlled mode for triggers
   * that race with their own dismiss logic (e.g. a Popover menu item).
   */
  trigger?: React.ReactNode;
  /**
   * Controlled-open mode. Pass `open` + `onOpenChange` to open the dialog
   * from outside (e.g. after a popover closes). When provided, the built-in
   * trigger is not rendered.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };

  if (typeof candidate.status === 'number') {
    return candidate.status;
  }

  if (typeof candidate.response?.status === 'number') {
    return candidate.response.status;
  }

  return null;
}

// Use the shared helper under a local alias so the rest of the file's
// call-sites don't need to change.
const getErrorMessage = getApiErrorMessage;

export const SaveAsTemplateDialog: React.FC<SaveAsTemplateDialogProps> = ({
  docId,
  hasApiDocumentId,
  canSaveTemplate,
  trigger,
  open: controlledOpen,
  onOpenChange,
}) => {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('article');
  const [isPublic, setIsPublic] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);

  const filesQuery = useQuery({
    ...getApiDocumentsByIdFilesOptions({
      path: { id: docId },
    }),
    enabled: open && hasApiDocumentId,
    staleTime: 15_000,
  });

  const saveTemplateMutation = useMutation({
    ...postApiDocumentsByIdSaveAsTemplateMutation(),
    onSuccess: async (createdTemplate) => {
      await queryClient.invalidateQueries({
        queryKey: getApiTemplatesQueryKey(),
      });
      toast.success(
        `Saved as template: ${createdTemplate?.title?.trim() || 'Untitled template'}`,
      );
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setCategory('article');
      setIsPublic(false);
      setSelectedFileIds([]);
    }
  }, [open]);

  const files = filesQuery.data ?? [];

  const selectedCount = selectedFileIds.length;

  const hasValidForm = useMemo(() => {
    return (
      title.trim().length > 0 &&
      category.trim().length > 0 &&
      category.trim().length <= 50
    );
  }, [category, title]);

  const toggleFileId = (fileId: string) => {
    setSelectedFileIds((current) => {
      if (current.includes(fileId)) {
        return current.filter((id) => id !== fileId);
      }
      return [...current, fileId];
    });
  };

  const handleSubmit = async () => {
    if (!hasApiDocumentId) {
      toast.error(
        'This document is not persisted yet. Save it first, then try again.',
      );
      return;
    }

    if (!hasValidForm) {
      toast.error(
        'Please provide a title and category before saving as template.',
      );
      return;
    }

    try {
      await saveTemplateMutation.mutateAsync({
        path: { id: docId },
        body: {
          title: title.trim(),
          description: description.trim() || null,
          category: category.trim(),
          isPublic,
          fileIds: selectedFileIds,
        },
      });
    } catch (error) {
      const status = getErrorStatus(error);
      const message = getErrorMessage(error);

      if (status === 422) {
        toast.error(
          message && message.toLowerCase().includes('no content')
            ? 'Add some content to your document before saving it as a template.'
            : (message ??
                'The document state is invalid. Try saving your document and retry.'),
        );
        return;
      }

      if (status === 403) {
        toast.error('You need owner or editor access to save this template.');
        return;
      }

      if (status === 404) {
        toast.error('Document not found. Refresh the page and try again.');
        return;
      }

      toast.error(message ?? 'Could not save this template.');
    }
  };

  if (!canSaveTemplate) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" variant="outline" size="sm" className="gap-2">
              <Save className="h-4 w-4" />
              Save as template
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
          <DialogDescription>
            Create a reusable template from this document. Select files
            explicitly before saving.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Template title
            </p>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={255}
              placeholder="My custom article"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </p>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              placeholder="Optional description"
              rows={4}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Category
              </p>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {TEMPLATE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {formatCategoryLabel(value)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Visibility
              </p>
              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={isPublic}
                  onChange={(event) => setIsPublic(event.target.checked)}
                />
                Make template public
              </label>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Include files ({selectedCount} selected)
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSelectedFileIds(
                      files
                        .map((file) => file.id ?? '')
                        .filter((fileId) => fileId.length > 0),
                    )
                  }
                  disabled={files.length === 0}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedFileIds([])}
                  disabled={selectedCount === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Files are excluded by default. Choose explicitly what should be
              part of this template.
            </p>

            <div className="max-h-56 space-y-2 overflow-auto rounded-md border border-border p-3">
              {filesQuery.isPending ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading files...
                </p>
              ) : filesQuery.isError ? (
                <p className="text-sm text-destructive">
                  Could not load document files.
                </p>
              ) : files.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No files found. This template will include only document
                  content.
                </p>
              ) : (
                files.map((file) => {
                  const fileId = file.id ?? '';
                  const isChecked =
                    fileId.length > 0 && selectedFileIds.includes(fileId);

                  return (
                    <label
                      key={fileId || `${file.filename}-${file.createdAt}`}
                      className="flex items-start gap-3 rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={isChecked}
                        onChange={() => {
                          if (fileId) {
                            toggleFileId(fileId);
                          }
                        }}
                        disabled={!fileId}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {file.filename?.trim() || 'unnamed file'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {file.contentType?.trim() || 'unknown type'}
                          <span className="ml-2 tabular-nums">
                            {formatBytes(file.size)}
                          </span>
                        </p>
                      </div>
                      {file.category && (
                        <Badge variant="outline">{file.category}</Badge>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saveTemplateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saveTemplateMutation.isPending || !hasValidForm}
            >
              {saveTemplateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save template'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
