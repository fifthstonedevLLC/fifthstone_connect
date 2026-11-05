import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { LeadPage } from './LeadPage';
import { Shell } from './Shell';
import { SignIn } from './SignIn';
import { supabase } from './supabase';
import { TodayPage } from './TodayPage';
import type { Me } from './types';
import { useApi } from './useApi';

function signOut() {
  void supabase.auth.signOut();
}

/** Signed in: load who this is, then show the portal or explain why there is no access. */
function SignedIn({ accessToken }: { accessToken: string }) {
  const [me, reload] = useApi<Me>('/portal/me', accessToken);
  const expired = me.status === 'error' && me.error.status === 401;

  // The API no longer accepts this session (expired or revoked): back to the sign-in screen.
  useEffect(() => {
    if (expired) signOut();
  }, [expired]);

  if (me.status === 'loading' || expired) {
    return (
      <p className="center-note" role="status">
        Loading your portal…
      </p>
    );
  }
  if (me.status === 'error') {
    const noAccess = me.error.status === 403;
    return (
      <main className="signin">
        <div className="signin__card" role="alert">
          <h1 className="signin__title">
            {noAccess ? 'No portal access' : 'Something went wrong'}
          </h1>
          <p className="signin__text">
            {noAccess
              ? 'This login is not connected to an active business. If you think that is wrong, contact Fifth Stone Dev.'
              : "We couldn't load your portal. Nothing has changed; try again in a moment."}
          </p>
          <div className="signin__actions">
            {!noAccess && (
              <button className="button button--primary" type="button" onClick={reload}>
                Try again
              </button>
            )}
            <button className="button" type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <Shell me={me.data} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<TodayPage me={me.data} accessToken={accessToken} />} />
        <Route path="/leads/:id" element={<LeadPage me={me.data} accessToken={accessToken} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <p className="center-note" role="status">
        Loading…
      </p>
    );
  }
  return session ? <SignedIn accessToken={session.access_token} /> : <SignIn />;
}
