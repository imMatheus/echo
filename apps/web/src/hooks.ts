/**
 * SWR-backed data layer over the Echo REST API (see api.ts).
 *
 * Every server read in the app goes through one of these hooks, so the SWR
 * cache is the single source of truth for server state. Mutations call the
 * plain `api.*` functions and then revalidate the relevant keys with `mutate`
 * (see the `useRevalidate*` helpers and each page's handlers).
 */
import { useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type { SWRConfiguration } from 'swr';
import { toast } from 'sonner';
import type { ListMemoriesQuery, ListMemoriesResponse } from '@echo/shared';
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
};

/** Matches every browse-list memories key, regardless of scope/kind/filters. */
const isMemoriesKey = (key: unknown): boolean => Array.isArray(key) && key[0] === 'memories';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Server metadata. Decorative in most call sites, so errors are swallowed. */
export function useMeta() {
  return useSWR(keys.meta, () => api.getMeta());
}

export function useScopes() {
  return useSWR(keys.scopes, () => api.listScopes().then((r) => r.scopes), toastOnError);
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
    toastOnError,
  );
}

export function useAudit(
  scopeKey: string,
  fetchPage: (q: AuditQuery) => Promise<import('@echo/shared').AuditListResponse>,
  query: AuditQuery,
) {
  return useSWR(keys.audit(scopeKey, query), () => fetchPage(query), toastOnError);
}

// ---------------------------------------------------------------------------
// Revalidation helpers
// ---------------------------------------------------------------------------

/**
 * Revalidate every memories list plus the scope list — call after creating,
 * editing, or deleting a memory (list previews and per-scope counts change).
 */
export function useRevalidateMemories() {
  const { mutate } = useSWRConfig();
  return useCallback(() => {
    void mutate(isMemoriesKey);
    void mutate(keys.scopes);
  }, [mutate]);
}
