import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGitHub: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Claim free signup credits (idempotent — no-ops if already claimed) */
async function claimFreeCredits(accessToken: string) {
  try {
    await fetch('/api/stripe/claim-free-credits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  } catch { /* endpoint may not be deployed yet */ }
}

const isLocalDev = false; // disabled to test real auth on localhost

const devUser = {
  id: 'dev-local-user',
  email: 'dev@localhost',
  user_metadata: { full_name: 'Local Dev', avatar_url: '' },
} as unknown as User;

const devSession = {
  access_token: 'dev-token',
  user: devUser,
} as unknown as Session;

/**
 * Synchronously peek at localStorage for a stored Supabase session.
 * Returns true if any `sb-*-auth-token` key is present, so we can skip the
 * initial loading screen for unauthenticated visitors without waiting on
 * a network RTT to confirm "no session".
 */
function hasStoredSession(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token') && localStorage.getItem(key)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(isLocalDev ? devUser : null);
  const [session, setSession] = useState<Session | null>(isLocalDev ? devSession : null);
  // Only block rendering when we actually have a stored session to restore.
  // Unauthenticated visitors (no token in localStorage) render immediately.
  const [loading, setLoading] = useState(isLocalDev ? false : hasStoredSession());

  useEffect(() => {
    if (isLocalDev) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        // Claim free credits for new users (fire-and-forget, idempotent)
        if (session?.access_token) {
          claimFreeCredits(session.access_token);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGitHub = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin },
    });
  };

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signInWithGitHub, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
