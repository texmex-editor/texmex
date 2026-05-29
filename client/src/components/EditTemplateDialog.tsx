import type { TemplateListResponse } from '@/client';
import {
  getApiTemplatesQueryKey,
  patchApiTemplatesByIdMutation,
} from '@/client/@tanstack/react-query.gen';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/utils/apiError';
import {
  TEMPLATE_CATEGORIES,
  formatCategoryLabel,
} from '@/utils/templateCategories';

type EditTemplateDialogProps = {
  template: TemplateListResponse | null;
  onClose: () => void;
};

// Owner-only edit dialog: title / description / category / visibility.
// Slug is intentionally not editable — the backend keeps it stable so any
// previously-shared link to the template detail page keeps working.
export const EditTemplateDialog: React.FC<EditTemplateDialogProps> = ({
  template,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [isPublic, setIsPublic] = useState(false);

  // Reset the form whenever a different template opens the dialog. Done in an
  // effect (not as a derived value) because the form fields are user-editable
  // — we only want to seed them on entry, not snap them back on every render.
  useEffect(() => {
    if (!template) return;
    setTitle(template.title ?? '');
    setDescription(template.description ?? '');
    setCategory((template.category ?? 'other').toLowerCase());
    setIsPublic(Boolean(template.isPublic));
  }, [template]);

  const updateMutation = useMutation({
    ...patchApiTemplatesByIdMutation(),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({
        queryKey: getApiTemplatesQueryKey(),
      });
      toast.success(`Updated "${updated?.title?.trim() || 'template'}"`);
      onClose();
    },
  });

  const handleSubmit = async () => {
    if (!template?.id) return;

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      toast.error('Title cannot be empty.');
      return;
    }

    try {
      await updateMutation.mutateAsync({
        path: { id: template.id },
        body: {
          title: trimmedTitle,
          description: description.trim() || null,
          category,
          isPublic,
        },
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error) ?? 'Could not update this template.');
    }
  };

  const open = Boolean(template);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
          <DialogDescription>
            Update the title, description, category, or visibility. Files and
            content stay as they are.
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
              Title
            </p>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={255}
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
              rows={3}
              placeholder="Optional description"
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
