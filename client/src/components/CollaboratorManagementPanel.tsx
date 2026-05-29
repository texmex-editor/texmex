import {
  type AccessLinkResponse,
  type AnonymousLinkResponse,
} from '@/client';
import {
  deleteApiDocumentsByDocumentIdAnonymousLinksByLinkIdMutation,
  deleteApiDocumentsByDocumentIdCollaboratorsByUserIdMutation,
  deleteApiDocumentsByDocumentIdLinksByLinkIdMutation,
  getApiDocumentsByDocumentIdAnonymousLinksOptions,
  getApiDocumentsByDocumentIdAnonymousLinksQueryKey,
  getApiDocumentsByDocumentIdCollaboratorsOptions,
  getApiDocumentsByDocumentIdCollaboratorsQueryKey,
  getApiDocumentsByDocumentIdLinksOptions,
  getApiDocumentsByDocumentIdLinksQueryKey,
  postApiDocumentsByDocumentIdAnonymousLinksMutation,
  postApiDocumentsByDocumentIdCollaboratorsMutation,
  postApiDocumentsByDocumentIdLinksMutation,
  putApiDocumentsByDocumentIdCollaboratorsByUserIdMutation,
} from '@/client/@tanstack/react-query.gen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  buildAnonymousJoinUrl,
  buildInviteJoinUrl,
} from '@/utils/documentRouting';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Plus, Share2, Trash2, UserPlus } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';

type CollaboratorManagementPanelProps = {
  docId: string;
};

function formatDate(value?: string): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function LinkStateBadge({ isActive }: { isActive?: boolean }) {
  return (
    <Badge variant={isActive ? 'default' : 'destructive'}>
      {isActive ? 'active' : 'revoked'}
    </Badge>
  );
}

// True when the link has a max-uses cap and has hit (or somehow passed) it.
// Server-side TryIncrementLinkUseCountAsync gates increments by `UseCount < MaxUses`,
// so in practice useCount never exceeds maxUses — but tolerate >= just in case
// (e.g. an admin lowered the cap below the current count).
function isExhausted(useCount?: number | null, maxUses?: number | null): boolean {
  if (maxUses == null) return false;
  return (useCount ?? 0) >= maxUses;
}

function formatLinkUsage(useCount?: number | null, maxUses?: number | null): string {
  const used = useCount ?? 0;
  if (maxUses == null) {
    return used === 1 ? '1 use (unlimited)' : `${used} uses (unlimited)`;
  }
  return `${used} of ${maxUses} uses`;
}

export const CollaboratorManagementPanel: React.FC<
  CollaboratorManagementPanelProps
> = ({ docId }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState('');
  const [newCollaboratorRole, setNewCollaboratorRole] = useState('editor');

  const [invitePermission, setInvitePermission] = useState('editor');
  const [inviteMaxUses, setInviteMaxUses] = useState('');

  const [anonymousPermission, setAnonymousPermission] = useState('viewer');

  const basePath = useMemo(() => ({ path: { documentId: docId } }), [docId]);

  const collaboratorsQuery = useQuery({
    ...getApiDocumentsByDocumentIdCollaboratorsOptions(basePath),
    enabled: open,
  });
  const linksQuery = useQuery({
    ...getApiDocumentsByDocumentIdLinksOptions(basePath),
    enabled: open,
  });
  const anonymousLinksQuery = useQuery({
    ...getApiDocumentsByDocumentIdAnonymousLinksOptions(basePath),
    enabled: open,
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getApiDocumentsByDocumentIdCollaboratorsQueryKey(basePath),
      }),
      queryClient.invalidateQueries({
        queryKey: getApiDocumentsByDocumentIdLinksQueryKey(basePath),
      }),
      queryClient.invalidateQueries({
        queryKey: getApiDocumentsByDocumentIdAnonymousLinksQueryKey(basePath),
      }),
    ]);
  };

  const addCollaboratorMutation = useMutation({
    ...postApiDocumentsByDocumentIdCollaboratorsMutation(),
    onSuccess: async () => {
      setNewCollaboratorEmail('');
      await invalidateAll();
      toast.success('Collaborator added.');
    },
  });

  const updateRoleMutation = useMutation({
    ...putApiDocumentsByDocumentIdCollaboratorsByUserIdMutation(),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Role updated.');
    },
  });

  const removeCollaboratorMutation = useMutation({
    ...deleteApiDocumentsByDocumentIdCollaboratorsByUserIdMutation(),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Collaborator removed.');
    },
  });

  const createInviteMutation = useMutation({
    ...postApiDocumentsByDocumentIdLinksMutation(),
    onSuccess: async () => {
      setInviteMaxUses('');
      await invalidateAll();
      toast.success('Invite link created.');
    },
  });

  const revokeInviteMutation = useMutation({
    ...deleteApiDocumentsByDocumentIdLinksByLinkIdMutation(),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Invite link revoked.');
    },
  });

  const createAnonymousLinkMutation = useMutation({
    ...postApiDocumentsByDocumentIdAnonymousLinksMutation(),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Anonymous link created.');
    },
  });

  const revokeAnonymousLinkMutation = useMutation({
    ...deleteApiDocumentsByDocumentIdAnonymousLinksByLinkIdMutation(),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Anonymous link revoked.');
    },
  });

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      toast.error('Could not copy link.');
    }
  };

  const handleAddCollaborator = async () => {
    const email = newCollaboratorEmail.trim();
    if (!email) {
      toast.error('Please enter an email address.');
      return;
    }

    try {
      await addCollaboratorMutation.mutateAsync({
        ...basePath,
        body: { email, role: newCollaboratorRole },
      });
    } catch {
      toast.error('Could not add collaborator.');
    }
  };

  const handleCreateInvite = async () => {
    // Empty or 0 → unlimited (null on the wire). The digit-strip onChange
    // already guarantees the string is "" or only digits, so parseInt is safe.
    const trimmed = inviteMaxUses.trim();
    const parsedMaxUses =
      trimmed === '' || trimmed === '0'
        ? null
        : Number.parseInt(trimmed, 10);

    try {
      await createInviteMutation.mutateAsync({
        ...basePath,
        body: {
          permission: invitePermission,
          maxUses: parsedMaxUses,
        },
      });
    } catch {
      toast.error('Could not create invite link.');
    }
  };

  const handleCreateAnonymousLink = async () => {
    try {
      await createAnonymousLinkMutation.mutateAsync({
        ...basePath,
        body: { permission: anonymousPermission },
      });
    } catch {
      toast.error('Could not create anonymous link.');
    }
  };

  const collaborators = collaboratorsQuery.data?.collaborators ?? [];
  const anonymousUsers = collaboratorsQuery.data?.anonymousUsers ?? [];
  const inviteLinks = linksQuery.data ?? [];
  const anonymousLinks = anonymousLinksQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <Share2 className="h-4 w-4" />
          Manage access
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Collaborators & Sharing</DialogTitle>
          <DialogDescription>
            Manage collaborators, invite links, and anonymous access links.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="collaborators" className="w-full">
          <TabsList>
            <TabsTrigger value="collaborators">Collaborators</TabsTrigger>
            <TabsTrigger value="links">Invite Links</TabsTrigger>
            <TabsTrigger value="anonymous-links">Anonymous Links</TabsTrigger>
          </TabsList>

          <TabsContent value="collaborators" className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Add by email
              </p>
              <form
                className="flex gap-2"
                onSubmit={event => {
                  event.preventDefault();
                  void handleAddCollaborator();
                }}
              >
                <Input
                  value={newCollaboratorEmail}
                  onChange={event => setNewCollaboratorEmail(event.target.value)}
                  placeholder="name@example.com"
                />
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={newCollaboratorRole}
                  onChange={event => setNewCollaboratorRole(event.target.value)}
                >
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
                <Button
                  type="submit"
                  disabled={addCollaboratorMutation.isPending}
                >
                  <UserPlus className="h-4 w-4" />
                  Add
                </Button>
              </form>
            </div>

            <div className="space-y-2">
              {collaborators.map(collaborator => (
                <div
                  key={`${collaborator.userId ?? collaborator.email ?? collaborator.displayName ?? 'user'}-${collaborator.addedAt ?? ''}`}
                  className="flex items-center gap-2 rounded-md border border-border p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {collaborator.displayName || collaborator.email || 'Unknown user'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {collaborator.email || '-'}
                    </p>
                  </div>

                  {collaborator.role === 'owner' ? (
                    <span className="text-xs text-muted-foreground">owner</span>
                  ) : (
                    <>
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value={collaborator.role || 'editor'}
                        onChange={event => {
                          if (!collaborator.userId) return;
                          void updateRoleMutation.mutateAsync({
                            path: {
                              documentId: docId,
                              userId: collaborator.userId,
                            },
                            body: { role: event.target.value },
                          });
                        }}
                      >
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (!collaborator.userId) return;
                          void removeCollaboratorMutation.mutateAsync({
                            path: {
                              documentId: docId,
                              userId: collaborator.userId,
                            },
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
              {collaborators.length === 0 && (
                <p className="text-sm text-muted-foreground">No collaborators yet.</p>
              )}
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Anonymous users
              </p>
              <div className="space-y-2">
                {anonymousUsers.map(user => (
                  <div
                    key={user.grantId ?? `${user.displayName}-${user.lastSeenAt}`}
                    className="rounded-md border border-border p-2"
                  >
                    <p className="text-sm font-medium">{user.displayName || 'Anonymous'}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.email || 'No email'} · {user.permission || 'viewer'} · last seen {formatDate(user.lastSeenAt)}
                    </p>
                  </div>
                ))}
                {anonymousUsers.length === 0 && (
                  <p className="text-sm text-muted-foreground">No active anonymous users.</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="links" className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Create invite link
              </p>
              <form
                className="flex gap-2"
                onSubmit={event => {
                  event.preventDefault();
                  void handleCreateInvite();
                }}
              >
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={invitePermission}
                  onChange={event => setInvitePermission(event.target.value)}
                >
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
                <Input
                  type="number"
                  inputMode="numeric"
                  // min=0 so the spinner can't dip below zero (and 0 maps to
                  // "unlimited" on submit). No max — and no min=1 — because a
                  // cap is optional.
                  min={0}
                  value={inviteMaxUses}
                  onChange={event =>
                    // Belt-and-braces: type=number accepts pasted non-digits in
                    // some browsers; strip everything but digits so the state
                    // is always "" or /^\d+$/.
                    setInviteMaxUses(event.target.value.replace(/\D/g, ''))
                  }
                  placeholder="Max uses (optional, 0 = unlimited)"
                />
                <Button
                  type="submit"
                  disabled={createInviteMutation.isPending}
                >
                  <Plus className="h-4 w-4" />
                  Create
                </Button>
              </form>
            </div>

            <div className="space-y-2">
              {inviteLinks.map((link: AccessLinkResponse) => {
                const inviteUrl = buildInviteJoinUrl(link.token ?? '');
                return (
                  <div key={link.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm">{link.permission || 'viewer'}</p>
                        <LinkStateBadge isActive={link.isActive} />
                        {isExhausted(link.useCount, link.maxUses) && (
                          <Badge variant="destructive">exhausted</Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatLinkUsage(link.useCount, link.maxUses)}
                      </p>
                    </div>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopyLink(inviteUrl)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    {link.isActive && (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (!link.id) return;
                          void revokeInviteMutation.mutateAsync({
                            path: { documentId: docId, linkId: link.id },
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
              {inviteLinks.length === 0 && (
                <p className="text-sm text-muted-foreground">No invite links yet.</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="anonymous-links" className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Create anonymous link
              </p>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={anonymousPermission}
                  onChange={event => setAnonymousPermission(event.target.value)}
                >
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
                <Button
                  type="button"
                  onClick={() => void handleCreateAnonymousLink()}
                  disabled={createAnonymousLinkMutation.isPending}
                >
                  <Link2 className="h-4 w-4" />
                  Create
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {anonymousLinks.map((link: AnonymousLinkResponse) => {
                const anonymousUrl = buildAnonymousJoinUrl(link.token ?? '');
                return (
                  <div key={link.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm">{link.permission || 'viewer'}</p>
                        <LinkStateBadge isActive={link.isActive} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">created {formatDate(link.createdAt)}</p>
                    </div>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopyLink(anonymousUrl)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    {link.isActive && (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (!link.id) return;

                          void revokeAnonymousLinkMutation.mutateAsync({
                            path: { documentId: docId, linkId: link.id },
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
              {anonymousLinks.length === 0 && (
                <p className="text-sm text-muted-foreground">No anonymous links yet.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};



