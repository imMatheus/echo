import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@echo/shared';
import * as api from './api';

interface AuthContextValue {
  user: User | null;
  personalScopeId: string | null;
  /** True while the initial GET /auth/me is in flight. */
  loading: boolean;
  /** Re-fetch /auth/me (e.g. after login/signup). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [personalScopeId, setPersonalScopeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.me();
      setUser(res.user);
      setPersonalScopeId(res.personalScopeId);
    } catch {
      setUser(null);
      setPersonalScopeId(null);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // clearing local state is enough if the server call fails
    }
    setUser(null);
    setPersonalScopeId(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, personalScopeId, loading, refresh, logout }),
    [user, personalScopeId, loading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
