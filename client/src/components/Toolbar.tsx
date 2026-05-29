import logo from '@/TexMex_Original_No_text.svg';
import type { AuthResponse } from '@/client';
import { AccountSettingsDialog } from '@/components/AccountSettingsDialog';
import { CollaboratorManagementPanel } from '@/components/CollaboratorManagementPanel';
import { ShareDocumentButton } from '@/components/ShareDocumentButton';
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import React from 'react';

interface ToolbarProps {
  docId: string;
  hasApiDocumentId?: boolean;
  status: string;
  statusClass: string;
  user?: AuthResponse | null;
  role?: 'owner' | 'editor' | 'viewer';
  canManageCollaborators?: boolean;
  onLogout?: () => Promise<void> | void;
  /**
   * Called when the user's display name or email is changed via the
   * Account Settings dialog. Lets the parent refresh its cached user.
   */
  onUserUpdated?: (user: AuthResponse) => void;
  /**
   * Optional center slot — used by the editor page to surface the document
   * title (rename + per-document actions) at the app level instead of inside
   * the cramped editor pane header.
   */
  centerSlot?: React.ReactNode;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  docId,
  hasApiDocumentId = false,
  status,
  statusClass,
  user,
  role,
  canManageCollaborators,
  onLogout,
  onUserUpdated,
  centerSlot,
}) => {
  const getInitials = (displayName?: string | null, email?: string | null) => {
    const source = (displayName || email || '').trim();
    if (!source) return '??';

    const words = source.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
    }

    return source.slice(0, 2).toUpperCase();
  };

  const statusVariant =
    statusClass === 'connected'
      ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
      : statusClass === 'compiling'
        ? 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
        : statusClass === 'error'
          ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
          : 'default';

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
      <a className="flex items-center gap-3" href={'/'}>
        <img src={logo} alt="TexMex" className="ml-2 h-10 w-18" />
        <div className="leading-tight">
          <h1 className="text-sm font-semibold text-foreground">TexMex</h1>
          <p className="text-xs text-muted-foreground">
            La<b>Tex</b> <b>M</b>ultiuser <b>ex</b>perience
          </p>
        </div>
      </a>

      {centerSlot && (
        <div className="ml-4 flex min-w-0 flex-1 items-center justify-center">
          {centerSlot}
        </div>
      )}

      <div className={`${centerSlot ? '' : 'ml-auto'} flex shrink-0 items-center gap-3`}>
        <AnimatedThemeToggler />

        {status && <Badge className={statusVariant}>{status}</Badge>}

        {docId.trim() && hasApiDocumentId && canManageCollaborators && (
          <CollaboratorManagementPanel docId={docId} />
        )}

        {docId.trim() && hasApiDocumentId && !canManageCollaborators && (
          <ShareDocumentButton docId={docId} canManageCollaborators={false} />
        )}

        {user && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-muted px-2 py-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
              {getInitials(user.displayName, user.email)}
            </div>
            <span className="max-w-32 truncate text-sm font-medium text-foreground">
              {user.displayName || user.email}
            </span>
            <AccountSettingsDialog user={user} onUserUpdated={onUserUpdated} />
            {onLogout && (
              <Button
                type="button"
                variant="secondary"
                className="h-7 px-2 text-xs"
                onClick={onLogout}
              >
                <LogOut size={12} />
                Logout
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
