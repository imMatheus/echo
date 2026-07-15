/**
 * SWR-backed data layer over the Echo REST API (see api.ts).
 *
 * Every server read in the app goes through one of these hooks, so the SWR
 * cache is the single source of truth for server state. Mutations call the
 * plain `api.*` functions and then revalidate the relevant keys with `mutate`
 * (see the `useRevalidate*` helpers and each page's handlers).
 */
import { useCallback, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type { SWRConfiguration } from 'swr';
import { toast } from 'sonner';
import type { ListMemoriesQuery, ListMemoriesResponse, ScopeWithAccess, StatsRange } from '@echo/shared';
import type { AuditQuery } from '@/api';
import * as api from '@/api';
import { ApiRequestError, errorMessage } from '@/api';

/** Surface any fetch error as a toast — the default for reads that should fail loudly. */
const toastOnError: SWRConfiguration = {
  onError: (err) => toast.error(errorMessage(err)),
};

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------
// Centralised so mutations can target or match them. Array keys carry params
// and are hashed stably by SWR, so a fresh object each render is fine.

export const keys = {
  me: '/auth/me',
  meta: '/meta',
  scopes: '/scopes',
  orgs: '/orgs',
  apiKeys: '/api-keys',
  org: (orgId: string) => ['org', orgId] as const,
  orgMembers: (orgId: string) => ['org:members', orgId] as const,
  scopeMembers: (scopeId: string) => ['scope:members', scopeId] as const,
  memory: (id: string) => ['memory', id] as const,
  memories: (query: ListMemoriesQuery) => ['memories', query] as const,
  search: (query: string, scope: string) => ['memories:search', query, scope] as const,
  audit: (scopeKey: string, query: AuditQuery) => ['audit', scopeKey, query] as const,
  stats: (range: string) => ['stats', range] as const,
};

const AUTHORIZATION_SNAPSHOT_PREFIXES = new Set([
  'org',
  'org:members',
  'scope:members',
  'memory',
  'memories',
  'audit',
  'stats',
]);

/** Semantic-search snapshots must be evicted without replaying their audited POST. */
export const isMemorySearchKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === 'memories:search';

/** Safe-to-refetch GET snapshots whose visibility depends on scope access. */
export const isAuthorizationSnapshotKey = (key: unknown): boolean =>
  key === keys.orgs ||
  (Array.isArray(key) && AUTHORIZATION_SNAPSHOT_PREFIXES.has(String(key[0])));

/** Data whose visibility can change when organization membership or role changes. */
export const isAuthorizationDependentKey = (key: unknown): boolean =>
  key === keys.scopes || isMemorySearchKey(key) || isAuthorizationSnapshotKey(key);

/** Stable fingerprint of the access-relevant fields returned by GET /scopes. */
export function scopeAccessSignature(
  scopes: ReadonlyArray<Pick<ScopeWithAccess, 'id' | 'canWrite' | 'canManage'>>,
): string {
  return scopes
    .map((scope) => `${scope.id}:${Number(scope.canWrite)}:${Number(scope.canManage)}`)
    .sort()
    .join('|');
}

const isMemoriesKey = (key: unknown): boolean => Array.isArray(key) && key[0] === 'memories';

/** Cached snapshots that should refetch on their next mount after a memory write. */
const isMemorySnapshotKey = (key: unknown): boolean =>
  Array.isArray(key) && (key[0] === 'memories:search' || key[0] === 'stats' || key[0] === 'audit');

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Server metadata. Decorative in most call sites, so errors are swallowed. */
export function useMeta() {
  return useSWR(keys.meta, () => api.getMeta());
}

export function useScopes() {
  return useSWR(keys.scopes, () => api.listScopes().then((r) => r.scopes), {
    ...toastOnError,
    // Authorization can change in another browser/session while this tab stays
    // open. Keep the privacy snapshot reasonably fresh even without refocus.
    refreshInterval: 60_000,
    refreshWhenHidden: false,
  });
}

/** Mount once inside the authenticated layout to purge data after access changes. */
export function useScopeAuthorizationGuard(): void {
  const { mutate } = useSWRConfig();
  const { data } = useScopes();
  const signature = data ? scopeAccessSignature(data) : null;
  const previousSignature = useRef(signature);

  useEffect(() => {
    if (signature === null) return;
    const previous = previousSignature.current;
    previousSignature.current = signature;
    if (previous === null || previous === signature) return;

    // Scope membership and canManage are the dashboard's authorization
    // snapshot. If either changes, remove every result derived from the old
    // access before refetching mounted GETs. Searches are audited POSTs, so
    // evict them without passive replay.
    void mutate(isMemorySearchKey, undefined, { revalidate: false });
    void mutate(isAuthorizationSnapshotKey, undefined, { revalidate: true });
  }, [mutate, signature]);
}

export function useOrgs() {
  return useSWR(keys.orgs, () => api.listOrgs().then((r) => r.orgs), toastOnError);
}

export function useApiKeys() {
  return useSWR(keys.apiKeys, () => api.listApiKeys().then((r) => r.keys), toastOnError);
}

export function useOrg(orgId: string) {
  return useSWR(orgId ? keys.org(orgId) : null, () => api.getOrg(orgId), {
    // 404/403 render as "not found" in the page, so don't also toast them.
    onError: (err) => {
      if (err instanceof ApiRequestError && (err.status === 404 || err.status === 403)) return;
      toast.error(errorMessage(err));
    },
  });
}

export function useOrgMembers(orgId: string) {
  return useSWR(
    orgId ? keys.orgMembers(orgId) : null,
    () => api.listOrgMembers(orgId).then((r) => r.members),
    toastOnError,
  );
}

export function useScopeMembers(scopeId: string) {
  return useSWR(
    scopeId ? keys.scopeMembers(scopeId) : null,
    () => api.listScopeMembers(scopeId).then((r) => r.members),
    toastOnError,
  );
}

export function useMemory(id: string | undefined) {
  return useSWR(id ? keys.memory(id) : null, () => api.getMemory(id as string).then((r) => r.memory), {
    // A missing memory is a normal "not found" state, handled by the page.
    keepPreviousData: false,
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 404) return;
      toast.error(errorMessage(err));
    },
  });
}

export function useMemories(query: ListMemoriesQuery) {
  return useSWR<ListMemoriesResponse>(keys.memories(query), () => api.listMemories(query), toastOnError);
}

/** Semantic search. Pass a null query to stay idle (browsing mode). */
export function useMemorySearch(query: string | null, scope: string) {
  return useSWR(
    query ? keys.search(query, scope) : null,
    ([, q, s]) =>
      api
        .searchMemories({
          query: q,
          scopeIds: s && s !== 'all' ? [s] : undefined,
          limit: 50,
        })
        .then((res) => ({ query: q, results: res.results, mode: res.mode })),
    {
      ...toastOnError,
      // Search is a POST that records a recall. Passive refocus/reconnect
      // revalidation would create audit events the user never initiated.
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}

export function useAudit(
  scopeKey: string,
  fetchPage: (q: AuditQuery) => Promise<import('@echo/shared').AuditListResponse>,
  query: AuditQuery,
) {
  return useSWR(keys.audit(scopeKey, query), () => fetchPage(query), toastOnError);
}

export function useStats(range: StatsRange) {
  return useSWR(keys.stats(range), () => api.getStats(range).then((r) => r.stats), toastOnError);
}

// ---------------------------------------------------------------------------
// Revalidation helpers
// ---------------------------------------------------------------------------

/**
 * Revalidate memory lists/searches plus scopes, stats, and audit — call after
 * creating, editing, or deleting a memory so every derived view catches up.
 */
export function useRevalidateMemories() {
  const { mutate } = useSWRConfig();
  return useCallback(() => {
    void mutate(isMemoriesKey);
    void mutate(keys.scopes);
    // Do not eagerly replay every cached semantic query or stats range. Those
    // can be expensive and would create misleading audit activity; evict them
    // so the next mounted view fetches a fresh snapshot instead.
    void mutate(isMemorySnapshotKey, undefined, { revalidate: false });
  }, [mutate]);
}
