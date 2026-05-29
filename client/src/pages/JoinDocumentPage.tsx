import { Button } from '@/components/ui/button';
import { ThemeToggleButton } from '@/components/ThemeToggleButton';
import { postApiJoinAnonymousByToken, postApiJoinByToken } from '@/client';
import { toEditorPath } from '@/utils/documentRouting';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

type JoinDocumentPageProps = {
  isAnonymous: boolean;
};

type JoinErrorCode = 401 | 404 | 410 | 'missing-token' | 'network' | 'unknown';

type JoinApiResult = Awaited<ReturnType<typeof postApiJoinByToken>>;

const inFlightJoinByKey = new Map<string, Promise<JoinApiResult>>();

function getOrCreateJoinRequest(isAnonymous: boolean, token: string): Promise<JoinApiResult> {
  const key = `${isAnonymous ? 'anonymous' : 'invite'}:${token}`;
  const existing = inFlightJoinByKey.get(key);
  if (existing) {
    return existing;
  }

  const request = (isAnonymous
    ? postApiJoinAnonymousByToken({ path: { token } })
    : postApiJoinByToken({ path: { token } })) as Promise<JoinApiResult>;

  const trackedRequest = request.finally(() => {
    inFlightJoinByKey.delete(key);
  });

  inFlightJoinByKey.set(key, trackedRequest);
  return trackedRequest;
}

const JoinDocumentPage: React.FC<JoinDocumentPageProps> = ({ isAnonymous }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useParams<{ token: string }>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<JoinErrorCode | null>(null);
  const [attemptKey, setAttemptKey] = useState(0);

  const modeLabel = useMemo(
    () => (isAnonymous ? 'anonymous link' : 'invite link'),
    [isAnonymous],
  );

  useEffect(() => {
    let isMounted = true;

    const joinDocument = async () => {
      if (isMounted) {
        setErrorCode(null);
        setErrorMessage(null);
      }

      if (!token) {
        setErrorCode('missing-token');
        setErrorMessage('Missing link token.');
        return;
      }

      try {
        const result = await getOrCreateJoinRequest(isAnonymous, token);

        if (!isMounted) {
          return;
        }

        if (result.data?.documentId) {
          navigate(toEditorPath(result.data.documentId), {
            replace: true,
          });
          return;
        }

        const status = result.response.status;

        if (status === 401) {
          setErrorCode(401);
          const returnToPath = location.pathname;
          navigate(`/?returnTo=${encodeURIComponent(returnToPath)}`, {
            replace: true,
          });
          return;
        }

        if (status === 404) {
          setErrorCode(404);
          setErrorMessage('This link is invalid or has expired.');
          return;
        }

        if (status === 410) {
          setErrorCode(410);
          setErrorMessage('This link has reached its usage limit.');
          return;
        }

        setErrorCode('unknown');
        setErrorMessage('Could not join document. Please try again.');
      } catch {
        if (!isMounted) {
          return;
        }
        setErrorCode('network');
        setErrorMessage('Could not reach the server. Please try again.');
      }
    };

    void joinDocument();

    return () => {
      isMounted = false;
    };
  }, [
    attemptKey,
    isAnonymous,
    location.pathname,
    navigate,
    token,
  ]);

  return (
    <div className="relative flex h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggleButton />
      </div>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-soft">
        <h1 className="text-xl font-semibold text-foreground">
          Open shared document
        </h1>
        {errorMessage ? (
          <>
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </p>
            <div className="mt-4 flex gap-2">
              {errorCode === 401 ? (
                <Button
                  className="w-full"
                  onClick={() => navigate('/', { replace: true })}
                >
                  Sign in
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => setAttemptKey((value) => value + 1)}
                >
                  Try again
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate('/', { replace: true })}
              >
                Back to home
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Joining document via {modeLabel}...
          </p>
        )}
      </div>
    </div>
  );
};

export default JoinDocumentPage;
