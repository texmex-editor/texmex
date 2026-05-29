import React, { useEffect, useState } from 'react';
import {
  Route,
  BrowserRouter as Router,
  Routes,
} from 'react-router-dom';
import type { AuthResponse } from './client';
import { Toaster } from './components/ui/sonner';
import { bootstrapSession, logoutSession } from './lib/session';
import EditorPage from './pages/EditorPage';
import GettingStartedPage from './pages/GettingStartedPage';
import JoinDocumentPage from './pages/JoinDocumentPage';
import LandingPage from './pages/LandingPage';

const App: React.FC = () => {
  const [user, setUser] = useState<AuthResponse | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    const hydrateSession = async () => {
      try {
        const sessionUser = await bootstrapSession();
        if (isMounted) {
          setUser(sessionUser);
        }
      } finally {
        if (isMounted) {
          setIsSessionLoading(false);
        }
      }
    };

    hydrateSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogout = async () => {
    await logoutSession();
    setUser(null);
  };

  const editorElement = isSessionLoading ? (
    <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
      Checking session…
    </div>
  ) : (
    <EditorPage user={user} onLogout={handleLogout} onUserUpdated={setUser} />
  );

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            <LandingPage
              user={user}
              onAuthSuccess={setUser}
              onLogout={handleLogout}
              isSessionLoading={isSessionLoading}
            />
          }
        />
        <Route
          path="/join/:token"
          element={<JoinDocumentPage isAnonymous={false} />}
        />
        <Route
          path="/join/anonymous/:token"
          element={<JoinDocumentPage isAnonymous />}
        />
        <Route
          path="/getting-started"
          element={<GettingStartedPage />}
        />
        <Route path="/documents/:entrypoint" element={editorElement} />
      </Routes>
      <Toaster />
    </Router>
  );
};

export default App;
