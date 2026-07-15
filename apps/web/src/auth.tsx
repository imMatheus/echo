import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  /** Non-authentication failure from the initial session check. */
  error: unknown;
  /** Re-fetch /auth/me (e.g. after login/signup). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { mutate: globalMutate } = useSWRConfig();
  // An unauthenticated visitor gets a 401 here — an expected "no user" state,
  // not an error to surface or retry.
  const { data, error, isLoading, mutate } = useSWR(keys.me, () => api.me(), {
    shouldRetryOnError: false,
    // A different tab can replace the shared HTTP-only session cookie. Focus
    // revalidation is immediate; polling also catches a visible side-by-side tab.
    refreshInterval: 60_000,
    refreshWhenHidden: false,
  });

  const unauthorized = error instanceof api.ApiRequestError && error.status === 401;
  const authCheckFailed = Boolean(error && !unauthorized);
  const currentUserId = unauthorized ? null : data?.user.id;
  const [cacheOwnerId, setCacheOwnerId] = useState<string | null>(null);
  const [cacheOwnerKnown, setCacheOwnerKnown] = useState(false);

  const clearPrivateCache = useCallback(async () => {
    // Keep deployment metadata: it is public and Login/Signup may already be
    // fetching it while the anonymous /auth/me request settles.
    await globalMutate((key) => key !== keys.me && key !== keys.meta, undefined, { revalidate: false });
  }, [globalMutate]);

  const clearSessionCache = useCallback(async () => {
    await globalMutate(() => true, undefined, { revalidate: false });
  }, [globalMutate]);

  const identityTransition =
    currentUserId !== undefined && (!cacheOwnerKnown || cacheOwnerId !== currentUserId);

  useEffect(() => {
    if (currentUserId === undefined) return;
    if (!cacheOwnerKnown) {
      setCacheOwnerId(currentUserId);
      setCacheOwnerKnown(true);
      return;
    }
    if (cacheOwnerId === currentUserId) return;

    let cancelled = false;
    void clearPrivateCache().then(() => {
      if (!cancelled) setCacheOwnerId(currentUserId);
    });
    return () => {
      cancelled = true;
    };
  }, [cacheOwnerId, cacheOwnerKnown, clearPrivateCache, currentUserId]);

  useEffect(() => {
    const onExpired = () => {
      void clearSessionCache();
    };
    window.addEventListener(api.AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(api.AUTH_EXPIRED_EVENT, onExpired);
  }, [clearSessionCache]);

  useEffect(() => {
    if (unauthorized) void clearPrivateCache();
  }, [clearPrivateCache, unauthorized]);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const logout = useCallback(async () => {
    // Do not claim success while the HTTP-only session cookie may still exist.
    await api.logout();
    // Drop the whole cache so nothing from this session leaks into the next.
    await clearSessionCache();
  }, [clearSessionCache]);

  const value = useMemo<AuthContextValue>(
    () => ({
      // Never mount account B over account A's cache. The transition renders a
      // neutral loading screen until every private SWR entry has been evicted.
      user: unauthorized || authCheckFailed || identityTransition ? null : (data?.user ?? null),
      personalScopeId:
        unauthorized || authCheckFailed || identityTransition ? null : (data?.personalScopeId ?? null),
      loading: isLoading || identityTransition,
      // A 401 is the normal anonymous state. Any other failed session check
      // fails closed: another tab may have replaced the cookie, so cached
      // account data cannot remain mounted until the identity is confirmed.
      error: !identityTransition && authCheckFailed ? error : null,
      refresh,
      logout,
    }),
    [authCheckFailed, data, error, identityTransition, isLoading, logout, refresh, unauthorized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
