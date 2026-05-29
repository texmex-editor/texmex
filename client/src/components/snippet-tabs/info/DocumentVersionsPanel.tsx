import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import {
  deleteApiDocumentsByDocumentIdVersionsByVersionIdMutation,
  getApiDocumentsByDocumentIdVersionsByVersionIdOptions,
  getApiDocumentsByDocumentIdVersionsOptions,
  getApiDocumentsByDocumentIdVersionsQueryKey,
  postApiDocumentsByDocumentIdVersionsByVersionIdRestoreMutation,
  postApiDocumentsByDocumentIdVersionsMutation,
} from '@/client/@tanstack/react-query.gen';
import { VersionDiffDialog } from './VersionDiffDialog';
import { getApiErrorMessage } from '@/components/snippet-tabs/files/utils';
import {ClipboardPlus, FileDiff, History, Trash2} from "lucide-react";
import { toast } from 'sonner';

type DocumentVersionsPanelProps = {
  docId: string;
  hasApiDocumentId: boolean;
  documentText: string;
  onApplyVersion?: (sourceText: string) => void;
  /**
   * When true, the panel shows a "Restore" button on each version that calls the
   * backend restore endpoint. The server then evicts all connected clients (close
   * code 1000, reason "version_restored"); the editor's WS close handler reconnects
   * with the same Y.Doc and refetches the file list. Viewers should not see this.
   */
  canRestoreVersion?: boolean;
};

function formatVersionDate(date?: string) {
  if (!date) {
    return 'Unknown date';
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown date';
  }

  return parsed.toLocaleString();
}

export const DocumentVersionsPanel: React.FC<DocumentVersionsPanelProps> = ({
  docId,
  hasApiDocumentId,
  documentText,
  onApplyVersion,
  canRestoreVersion = false,
}) => {
  const queryClient = useQueryClient();
  const [label, setLabel] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [isCreatePopoverOpen, setIsCreatePopoverOpen] = React.useState(false);
  const [selectedVersionId, setSelectedVersionId] = React.useState<string | null>(
    null,
  );
  const [selectedVersionLabel, setSelectedVersionLabel] = React.useState<string>('');
  const [isDiffOpen, setIsDiffOpen] = React.useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [pendingDeleteVersionId, setPendingDeleteVersionId] = React.useState<string | null>(null);
  const [pendingDeleteVersionLabel, setPendingDeleteVersionLabel] = React.useState('');
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = React.useState(false);
  const [pendingRestoreVersionId, setPendingRestoreVersionId] = React.useState<string | null>(null);
  const [pendingRestoreVersionLabel, setPendingRestoreVersionLabel] = React.useState('');

  const versionsQuery = useQuery({
    ...getApiDocumentsByDocumentIdVersionsOptions({
      path: { documentId: docId },
    }),
    enabled: hasApiDocumentId,
    refetchInterval: hasApiDocumentId ? 15000 : false,
  });

  const versionDetailQuery = useQuery({
    ...getApiDocumentsByDocumentIdVersionsByVersionIdOptions({
      path: {
        documentId: docId,
        versionId: selectedVersionId ?? '',
      },
    }),
    enabled: hasApiDocumentId && isDiffOpen && Boolean(selectedVersionId),
  });

  const createVersionMutation = useMutation({
    ...postApiDocumentsByDocumentIdVersionsMutation(),
    onSuccess: async () => {
      setLabel('');
      setMessage('');
      setSubmitError(null);
      setIsCreatePopoverOpen(false);
      await queryClient.invalidateQueries({
        queryKey: getApiDocumentsByDocumentIdVersionsQueryKey({
          path: { documentId: docId },
        }),
      });
    },
  });

  const deleteVersionMutation = useMutation({
    ...deleteApiDocumentsByDocumentIdVersionsByVersionIdMutation(),
    onSuccess: async () => {
      setDeleteError(null);
      await queryClient.invalidateQueries({
        queryKey: getApiDocumentsByDocumentIdVersionsQueryKey({
          path: { documentId: docId },
        }),
      });
    },
  });

  // Server-side restore: writes the snapshot back as a forward-delta edit on the
  // live Y.Doc, then evicts all connected WS clients with close code 1000 +
  // reason "version_restored". The editor's WS close handler reconnects on the
  // same provider and refetches the file list; nothing further is needed here.
  const restoreVersionMutation = useMutation({
    ...postApiDocumentsByDocumentIdVersionsByVersionIdRestoreMutation(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getApiDocumentsByDocumentIdVersionsQueryKey({
          path: { documentId: docId },
        }),
      });
    },
  });

  const versions = React.useMemo(() => {
    const items = [...(versionsQuery.data ?? [])];
    items.sort((a, b) => {
      const left = a.createdAt ? Date.parse(a.createdAt) : 0;
      const right = b.createdAt ? Date.parse(b.createdAt) : 0;
      return right - left;
    });
    return items;
  }, [versionsQuery.data]);

  const canSubmit = hasApiDocumentId && !createVersionMutation.isPending;

  const handleCreateVersion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasApiDocumentId) {
      return;
    }

    setSubmitError(null);

    try {
      await createVersionMutation.mutateAsync({
        path: { documentId: docId },
        body: {
          label: label.trim() || null,
          message: message.trim() || null,
        },
      });
    } catch (error) {
      const detail =
        getApiErrorMessage(error) ?? 'Could not create a new version.';
      setSubmitError(detail);
      toast.error(detail);
    }
  };

  const handleDeleteVersionClick = (versionId?: string, versionLabel?: string | null) => {
    if (!hasApiDocumentId || !versionId || deleteVersionMutation.isPending) {
      return;
    }

    setPendingDeleteVersionId(versionId);
    setPendingDeleteVersionLabel((versionLabel ?? '').trim() || 'Unnamed version');
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (!open && deleteVersionMutation.isPending) {
      return;
    }

    setIsDeleteDialogOpen(open);
    if (!open) {
      setPendingDeleteVersionId(null);
      setPendingDeleteVersionLabel('');
    }
  };

  const handleDeleteVersionConfirm = async () => {
    if (!hasApiDocumentId || !pendingDeleteVersionId || deleteVersionMutation.isPending) {
      return;
    }

    setDeleteError(null);

    try {
      await deleteVersionMutation.mutateAsync({
        path: {
          documentId: docId,
          versionId: pendingDeleteVersionId,
        },
      });
      handleDeleteDialogOpenChange(false);
    } catch (error) {
      const detail =
        getApiErrorMessage(error) ?? 'Could not delete this version.';
      setDeleteError(detail);
      toast.error(detail);
    }
  };

  const handleCompareVersion = (versionId?: string, versionLabel?: string | null) => {
    if (!versionId || !hasApiDocumentId) {
      return;
    }

    setSelectedVersionId(versionId);
    setSelectedVersionLabel((versionLabel ?? '').trim() || 'Unnamed version');
    setIsDiffOpen(true);
  };

  const handleDiffOpenChange = (open: boolean) => {
    setIsDiffOpen(open);
    if (!open) {
      setSelectedVersionId(null);
    }
  };

  const handleApplyVersion = () => {
    const sourceText = versionDetailQuery.data?.sourceText;
    if (!onApplyVersion || typeof sourceText !== 'string') {
      return;
    }

    onApplyVersion(sourceText);
    setIsDiffOpen(false);
    setSelectedVersionId(null);
  };

  const handleRestoreVersionClick = (
    versionId?: string,
    versionLabel?: string | null,
  ) => {
    if (
      !canRestoreVersion ||
      !hasApiDocumentId ||
      !versionId ||
      restoreVersionMutation.isPending
    ) {
      return;
    }
    setPendingRestoreVersionId(versionId);
    setPendingRestoreVersionLabel((versionLabel ?? '').trim() || 'Unnamed version');
    setIsRestoreDialogOpen(true);
  };

  const handleRestoreDialogOpenChange = (open: boolean) => {
    // Ignore close attempts while the request is in flight so the dialog
    // can't disappear mid-mutation.
    if (!open && restoreVersionMutation.isPending) {
      return;
    }
    setIsRestoreDialogOpen(open);
    if (!open) {
      setPendingRestoreVersionId(null);
      setPendingRestoreVersionLabel('');
    }
  };

  const handleRestoreVersionConfirm = async () => {
    if (
      !canRestoreVersion ||
      !hasApiDocumentId ||
      !pendingRestoreVersionId ||
      restoreVersionMutation.isPending
    ) {
      return;
    }
    try {
      await restoreVersionMutation.mutateAsync({
        path: { documentId: docId, versionId: pendingRestoreVersionId },
      });
      toast.success(
        `Restored "${pendingRestoreVersionLabel}" — reconnecting…`,
      );
      handleRestoreDialogOpenChange(false);
    } catch (error) {
      // The mutation itself failed (server returned non-2xx). The eviction
      // close handler only fires on success, so we surface the failure here.
      toast.error(
        getApiErrorMessage(error) ?? 'Could not restore this version.',
      );
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Document versions
      </h3>

      {!hasApiDocumentId ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Version history is available only for saved API documents.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              Save and manage snapshots of your document state.
            </p>
            <Popover
              open={isCreatePopoverOpen}
              onOpenChange={setIsCreatePopoverOpen}
            >
              <PopoverTrigger
                className={buttonVariants({ size: 'sm' })}
                disabled={createVersionMutation.isPending}
              >
                  <ClipboardPlus size={16} />
                  New version
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-2">
                <form onSubmit={handleCreateVersion} className="space-y-2">
                  <div className="space-y-1">
                    <Label htmlFor="version-label">Version Label</Label>
                    <Input
                      id="version-label"
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder="Optional short name"
                      maxLength={80}
                      disabled={!canSubmit}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="version-message">Version Message</Label>
                    <Textarea
                      id="version-message"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Optional notes about this snapshot"
                      maxLength={400}
                      disabled={!canSubmit}
                      rows={3}
                      aria-invalid={submitError ? 'true' : 'false'}
                      aria-describedby={submitError ? 'create-version-error' : undefined}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={!canSubmit}>
                      {createVersionMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                  {submitError && (
                    <p id="create-version-error" className="text-xs text-destructive">
                      {submitError}
                    </p>
                  )}
                </form>
              </PopoverContent>
            </Popover>
          </div>

          {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}

          {versionsQuery.isPending ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading versions...</p>
          ) : versionsQuery.isError ? (
            <p className="mt-3 text-sm text-destructive">
              Could not load document versions.
            </p>
          ) : versions.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No versions saved yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {versions.map((version, index) => (
                <li
                  key={version.id ?? `${version.createdAt ?? 'no-date'}-${index}`}
                  className="rounded-lg border border-border bg-muted/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {(version.label ?? '').trim() || 'Unnamed version'}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatVersionDate(version.createdAt)}
                    </span>
                  </div>
                  {(version.message ?? '').trim() && (
                    <p className="mt-1 text-xs text-muted-foreground">{version.message}</p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    by {(version.creatorDisplayName ?? '').trim() || 'Unknown author'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!version.id}
                      onClick={() => handleCompareVersion(version.id, version.label)}
                    >
                      <FileDiff size={16} />
                      Compare
                    </Button>
                    {canRestoreVersion && (
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        disabled={!version.id || restoreVersionMutation.isPending}
                        onClick={() =>
                          handleRestoreVersionClick(version.id, version.label)
                        }
                      >
                        <History size={16} />
                        {restoreVersionMutation.isPending &&
                        restoreVersionMutation.variables?.path.versionId === version.id
                          ? 'Restoring...'
                          : 'Restore'}
                      </Button>
                    )}
                    <div className="ml-auto">
                      <Button
                        variant="destructive"
                        type="button"
                        size="sm"
                        disabled={!version.id || deleteVersionMutation.isPending}
                        onClick={() => handleDeleteVersionClick(version.id, version.label)}
                      >
                        <Trash2 size={16} />
                        {deleteVersionMutation.isPending && deleteVersionMutation.variables?.path.versionId === version.id
                          ? 'Deleting...'
                          : 'Delete'}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <VersionDiffDialog
            open={isDiffOpen}
            onOpenChange={handleDiffOpenChange}
            title={`Compare: ${selectedVersionLabel}`}
            description="Saved version on the left, current document on the right."
            originalText={versionDetailQuery.data?.sourceText ?? ''}
            modifiedText={documentText}
            isLoading={versionDetailQuery.isPending}
            errorMessage={versionDetailQuery.isError ? 'Could not load version content for comparison.' : null}
            onApplyVersion={onApplyVersion ? handleApplyVersion : undefined}
          />

          <Dialog open={isDeleteDialogOpen} onOpenChange={handleDeleteDialogOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Delete Version</DialogTitle>
                <DialogDescription>
                  This action cannot be undone. Delete &quot;{pendingDeleteVersionLabel}&quot; permanently?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDeleteDialogOpenChange(false)}
                  disabled={deleteVersionMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleDeleteVersionConfirm();
                  }}
                  disabled={!pendingDeleteVersionId || deleteVersionMutation.isPending}
                  variant="destructive"
                >
                  {deleteVersionMutation.isPending ? 'Deleting...' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={isRestoreDialogOpen}
            onOpenChange={handleRestoreDialogOpenChange}
          >
            <DialogContent className="sm:max-w-[460px]">
              <DialogHeader>
                <DialogTitle>Restore this version?</DialogTitle>
                <DialogDescription>
                  Replace the current document state with &quot;{pendingRestoreVersionLabel}&quot;.
                  A &quot;Before restore&quot; snapshot is saved automatically so this can
                  be undone. Anyone currently editing this document will be disconnected
                  and reconnected to the restored state.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleRestoreDialogOpenChange(false)}
                  disabled={restoreVersionMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleRestoreVersionConfirm();
                  }}
                  disabled={
                    !pendingRestoreVersionId || restoreVersionMutation.isPending
                  }
                >
                  <History size={16} />
                  {restoreVersionMutation.isPending ? 'Restoring...' : 'Restore'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </section>
  );
};

