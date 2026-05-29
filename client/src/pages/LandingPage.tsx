import { NewDocumentDialog } from '@/components/NewDocumentDialog';
import { getApiErrorMessage } from '@/utils/apiError';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge.tsx';
import { ButtonGroup } from '@/components/ui/button-group.tsx';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@/components/ui/item.tsx';
import { toEditorPath } from '@/utils/documentRouting';
import {
  Clock3,
  FilePenLine,
  FilePlus,
  FileStack,
  History,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toolbar } from '../components/Toolbar';
import { ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import {
  getApiDocumentsByIdState,
  type AuthResponse,
  type DocumentListResponse,
  type VersionResponse,
} from '../client';
import {
  deleteApiDocumentsByIdMutation,
  getApiDocumentsByDocumentIdCollaboratorsOptions,
  getApiDocumentsByDocumentIdVersionsOptions,
  getApiDocumentsByIdActiveUsersOptions,
  getApiDocumentsByIdFilesOptions,
  getApiDocumentsOptions,
  getApiDocumentsQueryKey,
  postApiDocumentsMutation,
} from '../client/@tanstack/react-query.gen';
import { navigateWithViewTransition } from '../lib/viewTransition';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';

type LandingPageProps = {
  user: AuthResponse | null;
  onAuthSuccess: (user: AuthResponse) => void;
  onLogout: () => Promise<void> | void;
  isSessionLoading: boolean;
};

const LandingPage: React.FC<LandingPageProps> = ({
  user,
  onAuthSuccess,
  onLogout,
  isSessionLoading,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [isNewDocumentDialogOpen, setIsNewDocumentDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'owned' | 'shared'>(
    'all',
  );
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(
    null,
  );
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [documentPendingDelete, setDocumentPendingDelete] =
    useState<DocumentListResponse | null>(null);

  const returnTo = new URLSearchParams(location.search).get('returnTo');
  const safeReturnTo = returnTo && returnTo.startsWith('/') ? returnTo : null;

  const handleAuthSuccess = (authUser: AuthResponse) => {
    onAuthSuccess(authUser);
    if (safeReturnTo) {
      navigate(safeReturnTo, { replace: true });
    }
  };

  const getErrorStatus = (error: unknown): number | null => {
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
  };

  const formatUpdatedAt = (updatedAt?: string) => {
    if (!updatedAt) {
      return 'Updated recently';
    }

    const parsed = new Date(updatedAt);
    if (Number.isNaN(parsed.getTime())) {
      return 'Updated recently';
    }

    const elapsedMs = Date.now() - parsed.getTime();
    const RECENT_THRESHOLD_MS = 5 * 60 * 1000;

    if (elapsedMs < RECENT_THRESHOLD_MS) {
      return 'Updated recently';
    }

    const minutes = Math.floor(elapsedMs / (60 * 1000));
    if (minutes < 60) {
      return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
    }

    const days = Math.floor(hours / 24);
    if (days < 30) {
      return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
    }

    const months = Math.floor(days / 30);
    if (months < 12) {
      return `Updated ${months} month${months === 1 ? '' : 's'} ago`;
    }

    const years = Math.floor(months / 12);
    return `Updated ${years} year${years === 1 ? '' : 's'} ago`;
  };

  const documentsQuery = useQuery({
    ...getApiDocumentsOptions(),
    enabled: Boolean(user),
    refetchInterval: user ? 10000 : false,
  });

  const createDocumentMutation = useMutation({
    ...postApiDocumentsMutation(),
  });

  const deleteDocumentMutation = useMutation({
    ...deleteApiDocumentsByIdMutation(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getApiDocumentsQueryKey(),
      });
      setIsDeleteDialogOpen(false);
      setDocumentPendingDelete(null);
    },
    onSettled: () => {
      setDeletingDocumentId(null);
    },
  });

  const documents: DocumentListResponse[] = user
    ? (documentsQuery.data ?? [])
    : [];
  const sortedDocuments = useMemo(
    () =>
      [...documents].sort((left, right) => {
        const leftMs = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
        const rightMs = right.updatedAt
          ? new Date(right.updatedAt).getTime()
          : 0;
        return rightMs - leftMs;
      }),
    [documents],
  );
  const documentIds = useMemo(
    () =>
      sortedDocuments.flatMap((document) => (document.id ? [document.id] : [])),
    [sortedDocuments],
  );

  const activeUsersQueries = useQueries({
    queries: documentIds.map((id) => ({
      ...getApiDocumentsByIdActiveUsersOptions({
        path: { id },
      }),
      enabled: Boolean(user),
      refetchInterval: user ? 15000 : false,
      staleTime: 10000,
    })),
  });

  const filesQueries = useQueries({
    queries: documentIds.map((id) => ({
      ...getApiDocumentsByIdFilesOptions({
        path: { id },
      }),
      enabled: Boolean(user),
      staleTime: 10000,
    })),
  });

  const versionsQueries = useQueries({
    queries: documentIds.map((documentId) => ({
      ...getApiDocumentsByDocumentIdVersionsOptions({
        path: { documentId },
      }),
      enabled: Boolean(user),
      staleTime: 10000,
    })),
  });

  const collaboratorsQueries = useQueries({
    queries: documentIds.map((documentId) => ({
      ...getApiDocumentsByDocumentIdCollaboratorsOptions({
        path: { documentId },
      }),
      enabled: Boolean(user),
      staleTime: 10000,
    })),
  });

  const metadataByDocumentId = useMemo(() => {
    const metadata = new Map<
      string,
      {
        collaboratorCount: number;
        activeUsersCount: number;
        fileCount: number;
        latestVersion: VersionResponse | null;
        isPending: boolean;
      }
    >();

    documentIds.forEach((documentId, index) => {
      const activeUsers = activeUsersQueries[index]?.data ?? [];
      const files = filesQueries[index]?.data ?? [];
      const versions = versionsQueries[index]?.data ?? [];
      const collaborators = collaboratorsQueries[index]?.data;

      const latestVersion =
        [...versions].sort((left, right) => {
          const leftMs = left.createdAt
            ? new Date(left.createdAt).getTime()
            : 0;
          const rightMs = right.createdAt
            ? new Date(right.createdAt).getTime()
            : 0;
          return rightMs - leftMs;
        })[0] ?? null;

      metadata.set(documentId, {
        collaboratorCount:
          (collaborators?.collaborators?.length ?? 0) +
          (collaborators?.anonymousUsers?.length ?? 0),
        activeUsersCount: activeUsers.length,
        fileCount: files.length,
        latestVersion,
        isPending: Boolean(
          activeUsersQueries[index]?.isPending ||
          filesQueries[index]?.isPending ||
          versionsQueries[index]?.isPending ||
          collaboratorsQueries[index]?.isPending,
        ),
      });
    });

    return metadata;
  }, [
    activeUsersQueries,
    collaboratorsQueries,
    documentIds,
    filesQueries,
    versionsQueries,
  ]);

  const isDocumentsLoading = Boolean(user) && documentsQuery.isPending;
  const isCreatingDocument = createDocumentMutation.isPending;
  const ownedDocumentsCount = sortedDocuments.filter(
    (document) => document.role === 'owner',
  ).length;
  const sharedDocumentsCount = sortedDocuments.length - ownedDocumentsCount;
  const filteredDocuments = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return sortedDocuments.filter((document) => {
      const matchesRole =
        roleFilter === 'all' ||
        (roleFilter === 'owned' && document.role === 'owner') ||
        (roleFilter === 'shared' && document.role !== 'owner');

      if (!matchesRole) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const title = (document.title ?? '').toLowerCase();
      const ownerName = (document.ownerDisplayName ?? '').toLowerCase();
      const role = (document.role ?? '').toLowerCase();

      return (
        title.includes(normalizedSearch) ||
        ownerName.includes(normalizedSearch) ||
        role.includes(normalizedSearch)
      );
    });
  }, [roleFilter, searchQuery, sortedDocuments]);

  const documentsLoadError = documentsQuery.isError
    ? 'Could not load your documents.'
    : null;
  const createError = createDocumentMutation.isError
    ? 'Could not create a new document.'
    : null;
  const deleteError = deleteDocumentMutation.isError
    ? 'Could not delete the document.'
    : null;
  const error =
    fallbackError ?? createError ?? deleteError ?? documentsLoadError;

  const handleOpenDocument = (document: DocumentListResponse) => {
    if (!document.id) {
      return;
    }

    navigateWithViewTransition(navigate, toEditorPath(document.id));
  };

  const waitForDocumentState = async (documentId: string) => {
    const maxAttempts = 8;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const { data } = await getApiDocumentsByIdState({
          path: { id: documentId },
          parseAs: 'arrayBuffer',
          throwOnError: false,
        });

        if (data instanceof ArrayBuffer && data.byteLength > 0) {
          return;
        }
      } catch {
        // Retry a few times in case the template state is still initializing.
      }

      const waitMs = 120 + attempt * 120;
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), waitMs);
      });
    }
  };

  const handleCreateDocument = async ({
    title,
    templateId,
  }: {
    title: string;
    templateId: string | null;
  }): Promise<boolean> => {
    setFallbackError(null);

    try {
      const createdDocument = await createDocumentMutation.mutateAsync({
        body: {
          title: title.trim() || null,
          templateId,
        },
      });

      await queryClient.invalidateQueries({
        queryKey: getApiDocumentsQueryKey(),
      });

      const documentId = createdDocument?.id;
      if (!documentId) {
        setFallbackError(
          'Document was created, but no document id was returned.',
        );
        return false;
      }

      if (templateId) {
        await waitForDocumentState(documentId);
      }

      navigateWithViewTransition(
        navigate,
        toEditorPath(documentId, createdDocument.entrypoint),
      );

      return true;
    } catch (error) {
      const status = getErrorStatus(error);
      if (status === 404) {
        const detail =
          'Selected template is no longer available. Please choose another template.';
        setFallbackError(detail);
        toast.error(detail);
        return false;
      }

      const detail =
        getApiErrorMessage(error) ?? 'Could not create a new document.';
      setFallbackError(detail);
      toast.error(detail);
      return false;
    }
  };

  const handleDeleteDialogChange = (open: boolean) => {
    setIsDeleteDialogOpen(open);
    if (!open && !deleteDocumentMutation.isPending) {
      setDocumentPendingDelete(null);
    }
  };

  const handleDeleteDocumentClick = (document: DocumentListResponse) => {
    setFallbackError(null);
    setDocumentPendingDelete(document);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteDocumentConfirm = async () => {
    const document = documentPendingDelete;
    if (!document?.id) {
      return;
    }
    const documentId = document.id;

    setFallbackError(null);
    setDeletingDocumentId(documentId);

    try {
      await deleteDocumentMutation.mutateAsync({
        path: {
          id: documentId,
        },
      });
    } catch (error) {
      const detail =
        getApiErrorMessage(error) ?? 'Could not delete the document.';
      setFallbackError(detail);
      toast.error(detail);
    }
  };

  const formatVersionDate = (createdAt?: string) => {
    if (!createdAt) {
      return 'recently';
    }

    const parsed = new Date(createdAt);
    if (Number.isNaN(parsed.getTime())) {
      return 'recently';
    }

    return parsed.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getRoleBadgeVariant = (
    role?: string | null,
  ): 'default' | 'secondary' | 'outline' => {
    if (role === 'owner') {
      return 'default';
    }

    if (role === 'viewer') {
      return 'outline';
    }

    return 'secondary';
  };

  return (
    <div className="flex flex-col bg-background">
      <Toolbar
        docId=""
        hasApiDocumentId={false}
        status=""
        statusClass=""
        user={user}
        onLogout={onLogout}
      />
      <div className="min-h-0 flex-1 p-4 md:p-6">
        <ResizablePanelGroup
          direction="horizontal"
          className="rounded-2xl bg-card/90 shadow-soft backdrop-blur"
        >
          <ResizablePanel defaultSize={50} className="min-h-0">
            <div className="flex h-full flex-col p-6 md:p-10">
              <div className="mx-auto flex h-full w-full max-w-3xl flex-col ">
                <div className="shrink-0 text-center">
                  <h1 className="text-4xl font-bold tracking-tight text-foreground">
                    Welcome to TexMex
                  </h1>
                  <p className="mt-2 text-lg text-muted-foreground">
                    The collaborative LaTeX editor.
                  </p>
                  {user?.displayName && (
                    <p className="mt-3 inline-flex rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      Signed in as {user.displayName}
                    </p>
                  )}
                  <div className="mt-8 flex justify-center gap-4">
                    {!isSessionLoading && !user && (
                      <>
                        <LoginPage onAuthSuccess={handleAuthSuccess} />
                        <SignupPage onAuthSuccess={handleAuthSuccess} />
                      </>
                    )}
                  </div>
                  {!isSessionLoading && !user && (
                    <div className="mt-8 min-h-0 flex-1 space-y-4 pr-2 text-left">
                      <Card className="border-border/60 bg-card/95 shadow-md">
                        <CardHeader>
                          <CardTitle className="text-base">
                            Why TexMex?
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-lg border border-border p-3">
                            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <Zap size={16} />
                              Realtime collaboration
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Edit LaTeX together with live updates and no merge
                              conflicts.
                            </p>
                          </div>
                          <div className="rounded-lg border border-border p-3">
                            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <ShieldCheck size={16} />
                              Reliable compile flow
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Compile in a dedicated service and keep your
                              project state isolated.
                            </p>
                          </div>
                          <div className="rounded-lg border border-border p-3">
                            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <Sparkles size={16} />
                              Built for writing teams
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Roles, versions and sharing tools for papers,
                              reports and templates.
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-border/60 bg-card/95 shadow-md">
                        <CardHeader>
                          <CardTitle className="text-base">
                            Preview panel
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-md border border-border bg-muted/30 p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Editor
                              </p>
                              <pre className="mt-2 overflow-x-auto text-xs text-foreground">
                                {`\\section{Introduction}
Collaborative writing with live sync.

\\begin{itemize}
  \\item Share with your team
  \\item Compile instantly
\\end{itemize}`}
                              </pre>
                            </div>
                            <div className="rounded-md border border-border bg-muted/30 p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                PDF Preview
                              </p>
                              <div className="mt-2 rounded-sm border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                                Compiled output appears here with synchronized
                                updates as you type.
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>

                {!isSessionLoading && user && (
                  <Card className="mt-8 flex min-h-0 flex-1 flex-col border-border/60 bg-gradient-to-b from-card via-card to-muted/20 shadow-lg">
                    <CardHeader className="shrink-0">
                      <CardTitle>
                        <h2>Last Opened</h2>
                      </CardTitle>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Resume quickly with your most recently updated
                            documents.
                          </p>
                        </div>
                        <p className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {filteredDocuments.length} shown
                        </p>
                      </div>
                      <div className="grid gap-2 pt-2 sm:grid-cols-3">
                        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 shadow-sm">
                          <p className="text-xs text-muted-foreground">Owned</p>
                          <p className="text-base font-semibold text-foreground">
                            {ownedDocumentsCount}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 shadow-sm">
                          <p className="text-xs text-muted-foreground">
                            Shared
                          </p>
                          <p className="text-base font-semibold text-foreground">
                            {sharedDocumentsCount}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 shadow-sm">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="text-base font-semibold text-foreground">
                            {sortedDocuments.length}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex min-h-0 flex-1 flex-col">
                      <div className="shrink-0">
                        <div className="mt-4 flex items-end justify-between">
                          <Field>
                            <FieldLabel htmlFor="create-document-button">
                              Create new document
                            </FieldLabel>
                            <ButtonGroup>
                              <Button
                                id="create-document-button"
                                type="button"
                                onClick={() => setIsNewDocumentDialogOpen(true)}
                                disabled={isCreatingDocument}
                              >
                                <FilePlus />
                                New document
                              </Button>
                            </ButtonGroup>
                          </Field>
                          <Button variant="outline" asChild className="gap-2">
                            <Link to="/getting-started">
                              <Sparkles size={16} />
                              Getting started
                            </Link>
                          </Button>
                        </div>
                        <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div className="relative w-full md:max-w-sm">
                              <Search
                                size={14}
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                              />
                              <Input
                                value={searchQuery}
                                onChange={(event) =>
                                  setSearchQuery(event.target.value)
                                }
                                placeholder="Search title, owner, or role"
                                className="pl-9"
                              />
                            </div>
                            <ButtonGroup>
                              <Button
                                variant={
                                  roleFilter === 'all' ? 'default' : 'outline'
                                }
                                size="sm"
                                onClick={() => setRoleFilter('all')}
                              >
                                All
                              </Button>
                              <Button
                                variant={
                                  roleFilter === 'owned' ? 'default' : 'outline'
                                }
                                size="sm"
                                onClick={() => setRoleFilter('owned')}
                              >
                                Owned
                              </Button>
                              <Button
                                variant={
                                  roleFilter === 'shared' ? 'default' : 'outline'
                                }
                                size="sm"
                                onClick={() => setRoleFilter('shared')}
                              >
                                Shared
                              </Button>
                            </ButtonGroup>
                          </div>
                        </div>

                        {error && (
                          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {error}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
                        {isDocumentsLoading ? (
                          <p className="text-sm text-muted-foreground">
                            Loading documents...
                          </p>
                        ) : sortedDocuments.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            You do not have any documents yet.
                          </p>
                        ) : filteredDocuments.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No documents match your search or filter.
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            {filteredDocuments.map((document) => {
                              const canDelete = document.role === 'owner';
                              const isDeleting = Boolean(
                                document.id &&
                                deleteDocumentMutation.isPending &&
                                deletingDocumentId === document.id,
                              );
                              const metadata = document.id
                                ? metadataByDocumentId.get(document.id)
                                : null;

                              return (
                                <div
                                  key={
                                    document.id ??
                                    `${document.title}-${document.updatedAt}`
                                  }
                                  className="flex items-stretch"
                                >
                                  <Item
                                    variant="outline"
                                    className="bg-card/90 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                                  >
                                    <ItemContent>
                                      <ItemTitle>
                                        {document.title || 'Untitled'}
                                        <Badge
                                          variant={getRoleBadgeVariant(
                                            document.role,
                                          )}
                                        >
                                          {document.role || 'editor'}
                                        </Badge>
                                      </ItemTitle>
                                      <ItemDescription>
                                        Owner:{' '}
                                        {document.ownerDisplayName?.trim() ||
                                          'Unknown'}
                                        {' · '}
                                        {formatUpdatedAt(document.updatedAt)}
                                      </ItemDescription>
                                      <ItemDescription className="text-xs">
                                        {metadata?.isPending ? (
                                          'Loading document details...'
                                        ) : (
                                          <>
                                            <span className="inline-flex items-center gap-1">
                                              <Users size={12} />
                                              {metadata?.collaboratorCount ??
                                                0}{' '}
                                              collaborators
                                            </span>
                                            {' · '}
                                            <span className="inline-flex items-center gap-1">
                                              <Clock3 size={12} />
                                              {metadata?.activeUsersCount ??
                                                0}{' '}
                                              active now
                                            </span>
                                            {' · '}
                                            <span className="inline-flex items-center gap-1">
                                              <FileStack size={12} />
                                              {metadata?.fileCount ?? 0} files
                                            </span>
                                            {' · '}
                                            <span className="inline-flex items-center gap-1">
                                              <History size={12} />
                                              {metadata?.latestVersion
                                                ? `Version ${metadata.latestVersion.label?.trim() || 'snapshot'} (${formatVersionDate(metadata.latestVersion.createdAt)})`
                                                : 'No versions yet'}
                                            </span>
                                          </>
                                        )}
                                      </ItemDescription>
                                    </ItemContent>
                                    <ItemActions
                                      className={'flex gap-2 flex-col'}
                                    >
                                      <Button
                                        className={'w-full'}
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          handleOpenDocument(document)
                                        }
                                      >
                                        <FilePenLine />
                                        Open
                                      </Button>
                                      {canDelete && (
                                        <Button
                                          className={'w-full'}
                                          variant="destructive"
                                          size="sm"
                                          onClick={() => {
                                            handleDeleteDocumentClick(document);
                                          }}
                                        >
                                          <Trash2 size={16} />
                                          {isDeleting ? 'Deleting...' : 'Delete'}
                                        </Button>
                                      )}
                                    </ItemActions>
                                  </Item>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <Dialog open={isDeleteDialogOpen} onOpenChange={handleDeleteDialogChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Delete &quot;
              {documentPendingDelete?.title?.trim() || 'Untitled'}&quot;
              permanently?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDeleteDialogChange(false)}
              disabled={deleteDocumentMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleDeleteDocumentConfirm();
              }}
              disabled={
                !documentPendingDelete?.id || deleteDocumentMutation.isPending
              }
              variant="destructive"
            >
              {deleteDocumentMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewDocumentDialog
        open={isNewDocumentDialogOpen}
        onOpenChange={setIsNewDocumentDialogOpen}
        currentUserDisplayName={user?.displayName ?? null}
        isCreating={isCreatingDocument}
        onCreateDocument={handleCreateDocument}
      />
    </div>
  );
};

export default LandingPage;
