import type { AuthResponse } from '@/client';
import {
  patchApiAuthMeMutation,
  postApiAuthChangeEmailMutation,
  postApiAuthChangePasswordMutation,
} from '@/client/@tanstack/react-query.gen';
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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { getApiErrorMessage } from '@/utils/apiError';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Settings } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';

type AccountSettingsDialogProps = {
  user: AuthResponse;
  /**
   * Called when the display name or email changes server-side. Lets the
   * parent update the cached user state (toolbar avatar, etc.) without
   * a full reload.
   */
  onUserUpdated?: (updated: AuthResponse) => void;
};

// Display-name validation mirrors the server-side regex in AuthModels.cs.
const DISPLAY_NAME_RE = /^[a-zA-Z0-9._ ]+$/;
const DISPLAY_NAME_MIN = 3;
const DISPLAY_NAME_MAX = 30;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export const AccountSettingsDialog: React.FC<AccountSettingsDialogProps> = ({
  user,
  onUserUpdated,
}) => {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-7 w-7"
          aria-label="Account settings"
          title="Account settings"
        >
          <Settings className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-3 sm:max-w-[480px] sm:p-5">
        <DialogHeader>
          <DialogTitle>Account Settings</DialogTitle>
          <DialogDescription>
            Update your display name, password, or email address.
          </DialogDescription>
        </DialogHeader>

        {/* All three sections together can exceed viewport height (especially in
            Firefox at narrower windows). Keep the header pinned, scroll the body. */}
        <div className="flex-1 space-y-5 overflow-y-auto px-1">
          <DisplayNameSection user={user} onUserUpdated={onUserUpdated} />
          <Separator />
          <ChangePasswordSection />
          <Separator />
          <ChangeEmailSection user={user} onUserUpdated={onUserUpdated} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Display name ────────────────────────────────────────────────────────────

const DisplayNameSection: React.FC<{
  user: AuthResponse;
  onUserUpdated?: (u: AuthResponse) => void;
}> = ({ user, onUserUpdated }) => {
  const [value, setValue] = React.useState(user.displayName ?? '');
  const [error, setError] = React.useState<string | null>(null);

  // Re-sync the input when the parent's user prop changes (e.g. after another
  // form in this dialog updated it). Don't fight an in-progress edit, though.
  React.useEffect(() => {
    setValue(user.displayName ?? '');
  }, [user.displayName]);

  const mutation = useMutation({
    ...patchApiAuthMeMutation(),
    onSuccess: (data) => {
      if (data && onUserUpdated) {
        onUserUpdated(data);
      }
      toast.success('Display name updated');
      setError(null);
    },
    onError: (err) => {
      setError(getApiErrorMessage(err) ?? 'Could not update display name.');
    },
  });

  const trimmed = value.trim();
  const localValidationError =
    trimmed.length === 0
      ? null // empty input — treat as unchanged, disable submit
      : trimmed.length < DISPLAY_NAME_MIN
        ? `Display name must be at least ${DISPLAY_NAME_MIN} characters.`
        : trimmed.length > DISPLAY_NAME_MAX
          ? `Display name must be at most ${DISPLAY_NAME_MAX} characters.`
          : !DISPLAY_NAME_RE.test(trimmed)
            ? 'Display name can only contain letters, numbers, dots, spaces, and underscores.'
            : null;
  const isUnchanged = trimmed === (user.displayName ?? '').trim();
  const canSubmit =
    !mutation.isPending && !isUnchanged && trimmed.length > 0 && !localValidationError;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    mutation.mutate({ body: { displayName: trimmed } });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Display name</h3>
      <Label htmlFor="account-display-name" className="sr-only">
        Display name
      </Label>
      <Input
        id="account-display-name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={DISPLAY_NAME_MAX + 5} /* allow over-cap so we can show the validation error */
        disabled={mutation.isPending}
        aria-invalid={Boolean(localValidationError || error)}
      />
      {(localValidationError || error) && (
        <p className="text-xs text-destructive">
          {localValidationError ?? error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {mutation.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </form>
  );
};

// ─── Change password ─────────────────────────────────────────────────────────

const ChangePasswordSection: React.FC = () => {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const mutation = useMutation({
    ...postApiAuthChangePasswordMutation(),
    onSuccess: () => {
      toast.success('Password changed. Other devices have been signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setError(null);
    },
    onError: (err) => {
      setError(getApiErrorMessage(err) ?? 'Could not change password.');
    },
  });

  const newPasswordError =
    newPassword.length > 0 && newPassword.length < PASSWORD_MIN
      ? `New password must be at least ${PASSWORD_MIN} characters.`
      : newPassword.length > PASSWORD_MAX
        ? `New password must be at most ${PASSWORD_MAX} characters.`
        : null;
  const canSubmit =
    !mutation.isPending &&
    currentPassword.length > 0 &&
    newPassword.length >= PASSWORD_MIN &&
    newPassword.length <= PASSWORD_MAX;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    mutation.mutate({ body: { currentPassword, newPassword } });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Change password</h3>
      <p className="text-xs text-muted-foreground">
        For your security, you&apos;ll be signed out of all other devices when
        you change your password.
      </p>
      <div className="space-y-1">
        <Label htmlFor="account-current-password" className="text-xs">
          Current password
        </Label>
        <Input
          id="account-current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="account-new-password" className="text-xs">
          New password
        </Label>
        <Input
          id="account-new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={mutation.isPending}
          aria-invalid={Boolean(newPasswordError || error)}
        />
      </div>
      {(newPasswordError || error) && (
        <p className="text-xs text-destructive">{newPasswordError ?? error}</p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {mutation.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            'Change password'
          )}
        </Button>
      </div>
    </form>
  );
};

// ─── Change email ────────────────────────────────────────────────────────────

const ChangeEmailSection: React.FC<{
  user: AuthResponse;
  onUserUpdated?: (u: AuthResponse) => void;
}> = ({ user, onUserUpdated }) => {
  const [newEmail, setNewEmail] = React.useState('');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const mutation = useMutation({
    ...postApiAuthChangeEmailMutation(),
    onSuccess: (data) => {
      if (data && onUserUpdated) {
        onUserUpdated(data);
      }
      toast.success('Email changed. Other devices have been signed out.');
      setNewEmail('');
      setCurrentPassword('');
      setError(null);
    },
    onError: (err) => {
      setError(getApiErrorMessage(err) ?? 'Could not change email.');
    },
  });

  const trimmedNewEmail = newEmail.trim().toLowerCase();
  const isUnchanged = trimmedNewEmail === (user.email ?? '').trim().toLowerCase();
  // Cheap shape check; the server's [EmailAddress] validator does the real one.
  const localEmailError =
    newEmail.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedNewEmail)
      ? 'Enter a valid email address.'
      : isUnchanged && newEmail.length > 0
        ? 'New email matches your current email.'
        : null;
  const canSubmit =
    !mutation.isPending &&
    currentPassword.length > 0 &&
    newEmail.length > 0 &&
    !localEmailError;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    mutation.mutate({
      body: { newEmail: trimmedNewEmail, currentPassword },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Change email</h3>
      <p className="text-xs text-muted-foreground">
        After the change you&apos;ll log in with the new email. Other devices
        will be signed out.
      </p>
      <div className="space-y-1">
        <Label htmlFor="account-new-email" className="text-xs">
          New email
        </Label>
        <Input
          id="account-new-email"
          type="email"
          autoComplete="email"
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          placeholder={user.email ?? ''}
          disabled={mutation.isPending}
          aria-invalid={Boolean(localEmailError || error)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="account-email-current-password" className="text-xs">
          Current password
        </Label>
        <Input
          id="account-email-current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      {(localEmailError || error) && (
        <p className="text-xs text-destructive">{localEmailError ?? error}</p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {mutation.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            'Change email'
          )}
        </Button>
      </div>
    </form>
  );
};
