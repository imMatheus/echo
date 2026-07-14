import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type { User } from '@echo/shared';
import * as api from './api';
import { keys } from './hooks';

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
  const { mutate: globalMutate } = useSWRConfig();
  // An unauthenticated visitor gets a 401 here — an expected "no user" state,
  // not an error to surface or retry.
  const { data, isLoading, mutate } = useSWR(keys.me, () => api.me(), {
    shouldRetryOnError: false,
  });

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // clearing local state is enough if the server call fails
    }
    // Drop the whole cache so nothing from this session leaks into the next.
    await globalMutate(() => true, undefined, { revalidate: false });
  }, [globalMutate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: data?.user ?? null,
      personalScopeId: data?.personalScopeId ?? null,
      loading: isLoading,
      refresh,
      logout,
    }),
    [data, isLoading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
