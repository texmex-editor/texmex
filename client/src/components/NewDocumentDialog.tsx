import type { TemplateListResponse } from '@/client';
import {
  deleteApiTemplatesByIdMutation,
  getApiTemplatesByIdOptions,
  getApiTemplatesOptions,
  getApiTemplatesQueryKey,
} from '@/client/@tanstack/react-query.gen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FilePlus2,
  LayoutTemplate,
  Loader2,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/utils/apiError';
import { formatCategoryLabel } from '@/utils/templateCategories';
import { EditTemplateDialog } from '@/components/EditTemplateDialog';

const CATEGORY_ALL = 'all';

type NewDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserDisplayName?: string | null;
  isCreating: boolean;
  onCreateDocument: (args: {
    title: string;
    templateId: string | null;
  }) => Promise<boolean>;
};

function normalizeValue(value?: string | null): string {
  return (value ?? '').trim();
}

function isOwnedByUser(
  template: TemplateListResponse,
  currentUserDisplayName?: string | null,
): boolean {
  const owner = normalizeValue(template.ownerDisplayName).toLowerCase();
  const currentUser = normalizeValue(currentUserDisplayName).toLowerCase();
  return owner.length > 0 && currentUser.length > 0 && owner === currentUser;
}

export const NewDocumentDialog: React.FC<NewDocumentDialogProps> = ({
  open,
  onOpenChange,
  currentUserDisplayName,
  isCreating,
  onCreateDocument,
}) => {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [activeTab, setActiveTab] = useState<'system' | 'mine' | 'community'>(
    'system',
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(CATEGORY_ALL);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] =
    useState<TemplateListResponse | null>(null);
  const [editingTemplate, setEditingTemplate] =
    useState<TemplateListResponse | null>(null);

  const templatesQuery = useQuery({
    ...getApiTemplatesOptions(),
    enabled: open,
    staleTime: 30_000,
  });

  const deleteTemplateMutation = useMutation({
    ...deleteApiTemplatesByIdMutation(),
    onSuccess: async (_data, variables) => {
      // Drop the just-deleted template from the local cache so the row disappears
      // immediately even before the refetch resolves.
      if (selectedTemplateId === variables.path.id) {
        setSelectedTemplateId(null);
      }
      await queryClient.invalidateQueries({
        queryKey: getApiTemplatesQueryKey(),
      });
    },
  });

  const selectedTemplateDetailQuery = useQuery({
    ...getApiTemplatesByIdOptions({
      path: { id: selectedTemplateId ?? '' },
    }),
    enabled: open && Boolean(selectedTemplateId),
    staleTime: 30_000,
  });

  const templates = templatesQuery.data ?? [];

  const categories = useMemo(() => {
    const next = new Set<string>();
    templates.forEach((template) => {
      const category = normalizeValue(template.category).toLowerCase();
      if (category) {
        next.add(category);
      }
    });

    return [
      CATEGORY_ALL,
      ...Array.from(next).sort((left, right) => left.localeCompare(right)),
    ];
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const byVisibility = templates.filter((template) => {
      const isSystem = Boolean(template.isSystem);
      const ownedByUser = isOwnedByUser(template, currentUserDisplayName);
      const isCommunity =
        !isSystem && Boolean(template.isPublic) && !ownedByUser;

      if (activeTab === 'system') {
        return isSystem;
      }

      if (activeTab === 'mine') {
        return !isSystem && ownedByUser;
      }

      return isCommunity;
    });

    return byVisibility.filter((template) => {
      const templateCategory = normalizeValue(template.category).toLowerCase();
      const categoryMatches =
        categoryFilter === CATEGORY_ALL || templateCategory === categoryFilter;

      if (!categoryMatches) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const titleMatches = normalizeValue(template.title)
        .toLowerCase()
        .includes(normalizedQuery);
      const descriptionMatches = normalizeValue(template.description)
        .toLowerCase()
        .includes(normalizedQuery);
      const ownerMatches = normalizeValue(template.ownerDisplayName)
        .toLowerCase()
        .includes(normalizedQuery);

      return titleMatches || descriptionMatches || ownerMatches;
    });
  }, [
    activeTab,
    categoryFilter,
    currentUserDisplayName,
    searchQuery,
    templates,
  ]);

  const selectedTemplate = useMemo(
    () =>
      templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle('');
      setSelectedTemplateId(null);
      setSearchQuery('');
      setCategoryFilter(CATEGORY_ALL);
      setActiveTab('system');
    }

    onOpenChange(nextOpen);
  };

  const handleConfirmDeleteTemplate = async () => {
    if (!pendingDeleteTemplate?.id) {
      return;
    }
    const templateTitle =
      normalizeValue(pendingDeleteTemplate.title) || 'template';
    try {
      await deleteTemplateMutation.mutateAsync({
        path: { id: pendingDeleteTemplate.id },
      });
      toast.success(`Deleted "${templateTitle}"`);
      setPendingDeleteTemplate(null);
    } catch (error) {
      const detail =
        getApiErrorMessage(error) ?? `Could not delete "${templateTitle}".`;
      toast.error(detail);
    }
  };

  const handleCreate = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }

    const created = await onCreateDocument({
      title: normalizedTitle,
      templateId: selectedTemplateId,
    });

    if (created) {
      handleDialogChange(false);
    }
  };

  const detail = selectedTemplateDetailQuery.data;
  const selectedFiles = detail?.files ?? [];

  return (
    <>
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-3 sm:max-w-4xl sm:p-5 lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Create Document</DialogTitle>
          <DialogDescription>
            Start from a blank page or use a template as your starting point.
          </DialogDescription>
        </DialogHeader>

        {/* overflow-y-auto pins the header + footer and scrolls the body when
            the template preview / file list grows beyond the viewport. (Was
            previously removed by an unrelated overflow fix, which caused the
            Cancel/Create footer to be clipped on smaller windows.) */}
        <div className="flex-1 space-y-4 overflow-y-auto px-1">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Title
            </p>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={255}
              placeholder="My new project"
              disabled={isCreating}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isCreating) {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Blank document
            </p>
            <button
              type="button"
              onClick={() => setSelectedTemplateId(null)}
              className={`flex w-full items-center gap-3 rounded-md border bg-background px-3 py-2 text-left transition hover:border-primary/60 ${
                selectedTemplateId
                  ? 'border-border/60'
                  : 'border-primary/60'
              }`}
            >
              <FilePlus2 className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  Start empty
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Create a blank LaTeX document without template files.
                </p>
              </div>
              {!selectedTemplateId && (
                <Badge className="ml-auto shrink-0">Selected</Badge>
              )}
            </button>
          </div>

          <Separator />

          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] pb-1">
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search templates"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category === CATEGORY_ALL
                        ? 'All categories'
                        : formatCategoryLabel(category)}
                    </option>
                  ))}
                </select>
              </div>

              <Tabs
                value={activeTab}
                onValueChange={(value) =>
                  setActiveTab(value as 'system' | 'mine' | 'community')
                }
              >
                <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3">
                  <TabsTrigger value="system">Base Templates</TabsTrigger>
                  <TabsTrigger value="mine">My Templates</TabsTrigger>
                  <TabsTrigger value="community">
                    Community Templates
                  </TabsTrigger>
                </TabsList>

                <TabsContent value={activeTab}>
                  <div className="max-h-72 space-y-2 overflow-auto pr-1 sm:max-h-90">
                    {templatesQuery.isPending ? (
                      <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading templates...
                      </div>
                    ) : templatesQuery.isError ? (
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        Could not load templates.
                      </div>
                    ) : filteredTemplates.length === 0 ? (
                      <div className="rounded-md border border-border px-3 py-3 text-sm text-muted-foreground">
                        No templates found for this filter.
                      </div>
                    ) : (
                      filteredTemplates.map((template) => {
                        const templateId = template.id ?? '';
                        const isSelected =
                          templateId.length > 0 &&
                          templateId === selectedTemplateId;
                        const ownerDisplay =
                          normalizeValue(template.ownerDisplayName) || 'TexMex';
                        // Only owners can delete their non-system templates. The
                        // system/community tabs filter these out, but check here
                        // too so a future filter change doesn't expose Delete
                        // for templates the user doesn't own.
                        const canDelete =
                          !template.isSystem &&
                          templateId.length > 0 &&
                          isOwnedByUser(template, currentUserDisplayName);
                        const isDeleting =
                          deleteTemplateMutation.isPending &&
                          deleteTemplateMutation.variables?.path.id ===
                            templateId;

                        return (
                          <div
                            key={
                              templateId ||
                              `${template.slug}-${template.createdAt}`
                            }
                            className={[
                              'group flex items-stretch rounded-md border transition',
                              isSelected
                                ? 'border-primary bg-primary/5'
                                : 'border-border/60 bg-background hover:border-primary/40',
                            ].join(' ')}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (templateId) {
                                  setSelectedTemplateId(templateId);
                                }
                              }}
                              className="min-w-0 flex-1 px-3 py-3 text-left"
                            >
                              <div className="flex items-start gap-2">
                                <LayoutTemplate className="mt-0.5 h-4 w-4 text-primary" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {normalizeValue(template.title) ||
                                      'Untitled template'}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                    {normalizeValue(template.description) ||
                                      'No description'}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <Badge variant="secondary">
                                      {formatCategoryLabel(template.category)}
                                    </Badge>
                                    {!template.isSystem && (
                                      <Badge variant="outline">
                                        By {ownerDisplay}
                                      </Badge>
                                    )}
                                    {!template.isSystem &&
                                      template.isPublic && (
                                        <Badge variant="outline">Public</Badge>
                                      )}
                                  </div>
                                </div>
                                {isSelected && <Badge>Selected</Badge>}
                              </div>
                            </button>
                            {canDelete && (
                              <div className="flex items-start gap-0.5 px-2 py-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingTemplate(template);
                                  }}
                                  disabled={isDeleting}
                                  aria-label={`Edit template "${normalizeValue(template.title) || 'Untitled template'}"`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setPendingDeleteTemplate(template);
                                  }}
                                  disabled={isDeleting}
                                  aria-label={`Delete template "${normalizeValue(template.title) || 'Untitled template'}"`}
                                >
                                  {isDeleting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <Card className="h-fit border-border/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Template preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {!selectedTemplate ? (
                  <p className="text-muted-foreground">
                    Blank document selected.
                  </p>
                ) : selectedTemplateDetailQuery.isPending ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading preview...
                  </p>
                ) : selectedTemplateDetailQuery.isError ? (
                  <p className="text-destructive">
                    Could not load template preview.
                  </p>
                ) : (
                  <>
                    <p className="font-medium text-foreground">
                      {normalizeValue(detail?.title) ||
                        normalizeValue(selectedTemplate.title) ||
                        'Untitled template'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {normalizeValue(detail?.description) || 'No description'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary">
                        {formatCategoryLabel(detail?.category)}
                      </Badge>
                      {!detail?.isSystem && (
                        <Badge variant="outline">User</Badge>
                      )}
                      {detail?.isPublic && (
                        <Badge variant="outline">Public</Badge>
                      )}
                    </div>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Included files ({selectedFiles.length})
                      </p>
                      {selectedFiles.length === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          No template files included.
                        </p>
                      ) : (
                        <ul className="mt-1 max-h-24 space-y-1 overflow-auto text-xs text-muted-foreground sm:max-h-28">
                          {selectedFiles.map((file) => (
                            <li
                              key={file.id ?? `${file.filename}-${file.size}`}
                            >
                              {normalizeValue(file.filename) || 'unnamed file'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        LaTeX preview
                      </p>
                      <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-muted/20 p-2 text-[11px] leading-relaxed text-foreground sm:max-h-40">
                        {normalizeValue(detail?.content) ||
                          'No content preview available.'}
                      </pre>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleDialogChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleCreate()}
            disabled={isCreating || title.trim().length === 0}
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <FilePlus2 className="h-4 w-4" />
                Create document
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={pendingDeleteTemplate !== null}
      onOpenChange={(nextOpen) => {
        // Ignore close attempts while the request is in flight so the dialog can't
        // disappear mid-mutation and orphan the toast handling.
        if (!nextOpen && deleteTemplateMutation.isPending) {
          return;
        }
        if (!nextOpen) {
          setPendingDeleteTemplate(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Delete Template</DialogTitle>
          <DialogDescription>
            This action cannot be undone. Delete &quot;
            {normalizeValue(pendingDeleteTemplate?.title) || 'Untitled template'}
            &quot; permanently?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPendingDeleteTemplate(null)}
            disabled={deleteTemplateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirmDeleteTemplate()}
            disabled={deleteTemplateMutation.isPending}
          >
            {deleteTemplateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <EditTemplateDialog
      template={editingTemplate}
      onClose={() => setEditingTemplate(null)}
    />
    </>
  );
};
