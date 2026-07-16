/**
 * Typed fetch wrapper around the Echo REST API (see docs/API.md).
 * Same-origin; the session cookie rides along automatically.
 */

import type {
  ApiError,
  ApiKeyInfo,
  AuditListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateMemoryRequest,
  CreateOrgRequest,
  CreateScopeRequest,
  ForgotPasswordRequest,
  ListMemoriesQuery,
  ListMemoriesResponse,
  LoginRequest,
  MeResponse,
  Memory,
  OrgMember,
  OrgRole,
  Organization,
  OrganizationWithRole,
  ResendVerificationRequest,
  ResetPasswordRequest,
  ScopeMember,
  ScopeWithAccess,
  SearchMemoriesRequest,
  SearchMemoriesResponse,
  ServerMeta,
  SignupRequest,
  SignupResponse,
  StatsRange,
  StatsResponse,
  UpdateMemoryRequest,
  User,
  VerifyEmailRequest,
} from '@echo/shared';

const BASE = '/api/v1';
const REQUEST_TIMEOUT_MS = 30_000;

/** Emitted when an authenticated API call discovers that the session expired. */
export const AUTH_EXPIRED_EVENT = 'echo:auth-expired';

export type ApiErrorCode = ApiError['error']['code'];

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

/** Human-readable message for any thrown value (ApiRequestError-aware). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

type Query = Record<string, string | number | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let url = BASE + path;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    window.clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      throw new ApiRequestError(0, 'internal_error', 'Request timed out after 30 seconds');
    }
    throw new ApiRequestError(0, 'internal_error', 'Could not reach the server');
  }

  try {
    if (!res.ok) {
      let code: ApiErrorCode = 'internal_error';
      let message = `Request failed (${res.status})`;
      try {
        const data = (await res.json()) as Partial<ApiError>;
        if (data?.error?.code) code = data.error.code;
        if (data?.error?.message) message = data.error.message;
      } catch {
        if (controller.signal.aborted) {
          throw new ApiRequestError(0, 'internal_error', 'Request timed out after 30 seconds');
        }
        // non-JSON error body; keep defaults
      }
      if (res.status === 401 && !path.startsWith('/auth/')) {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      }
      throw new ApiRequestError(res.status, code, message);
    }

    try {
      return (await res.json()) as T;
    } catch {
      if (controller.signal.aborted) {
        throw new ApiRequestError(0, 'internal_error', 'Request timed out after 30 seconds');
      }
      throw new ApiRequestError(0, 'internal_error', 'The server returned an invalid response');
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function getMeta(): Promise<ServerMeta> {
  return request<ServerMeta>('/meta');
}

export function getHealth(): Promise<{ ok: boolean; db: boolean }> {
  return request<{ ok: boolean; db: boolean }>('/health');
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function signup(body: SignupRequest): Promise<SignupResponse> {
  return request<SignupResponse>('/auth/signup', { method: 'POST', body });
}

export function verifyEmail(body: VerifyEmailRequest): Promise<{ user: User }> {
  return request<{ user: User }>('/auth/verify-email', { method: 'POST', body });
}

export function resendVerification(body: ResendVerificationRequest): Promise<{ ok: true }> {
  return request<{ ok: true }>('/auth/resend-verification', { method: 'POST', body });
}

export function login(body: LoginRequest): Promise<{ user: User }> {
  return request<{ user: User }>('/auth/login', { method: 'POST', body });
}

export function forgotPassword(body: ForgotPasswordRequest): Promise<{ ok: true }> {
  return request<{ ok: true }>('/auth/forgot-password', { method: 'POST', body });
}

export function resetPassword(body: ResetPasswordRequest): Promise<{ ok: true }> {
  return request<{ ok: true }>('/auth/reset-password', { method: 'POST', body });
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/auth/logout', { method: 'POST' });
}

export function me(): Promise<MeResponse> {
  return request<MeResponse>('/auth/me');
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

export function listMemories(q: ListMemoriesQuery = {}): Promise<ListMemoriesResponse> {
  return request<ListMemoriesResponse>('/memories', {
    query: {
      scopeId: q.scopeId,
      q: q.q,
      kind: q.kind,
      sensitivity: q.sensitivity,
      sourceApp: q.sourceApp,
      tag: q.tag,
      limit: q.limit,
      offset: q.offset,
    },
  });
}

export function createMemory(body: CreateMemoryRequest): Promise<{ memory: Memory }> {
  return request<{ memory: Memory }>('/memories', { method: 'POST', body });
}

export function searchMemories(body: SearchMemoriesRequest): Promise<SearchMemoriesResponse> {
  return request<SearchMemoriesResponse>('/memories/search', { method: 'POST', body });
}

export function getMemory(id: string): Promise<{ memory: Memory }> {
  return request<{ memory: Memory }>(`/memories/${encodeURIComponent(id)}`);
}

export function updateMemory(id: string, body: UpdateMemoryRequest): Promise<{ memory: Memory }> {
  return request<{ memory: Memory }>(`/memories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
  });
}

export function deleteMemory(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export function listScopes(): Promise<{ scopes: ScopeWithAccess[] }> {
  return request<{ scopes: ScopeWithAccess[] }>('/scopes');
}

export function createScope(body: CreateScopeRequest): Promise<{ scope: ScopeWithAccess }> {
  return request<{ scope: ScopeWithAccess }>('/scopes', { method: 'POST', body });
}

export function deleteScope(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/scopes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function listScopeMembers(scopeId: string): Promise<{ members: ScopeMember[] }> {
  return request<{ members: ScopeMember[] }>(`/scopes/${encodeURIComponent(scopeId)}/members`);
}

export function addScopeMember(scopeId: string, email: string): Promise<{ member: ScopeMember }> {
  return request<{ member: ScopeMember }>(`/scopes/${encodeURIComponent(scopeId)}/members`, {
    method: 'POST',
    body: { email },
  });
}

export function removeScopeMember(scopeId: string, userId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/scopes/${encodeURIComponent(scopeId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export function listOrgs(): Promise<{ orgs: OrganizationWithRole[] }> {
  return request<{ orgs: OrganizationWithRole[] }>('/orgs');
}

export function createOrg(body: CreateOrgRequest): Promise<{ org: Organization }> {
  return request<{ org: Organization }>('/orgs', { method: 'POST', body });
}

export function getOrg(id: string): Promise<{ org: Organization; role: OrgRole }> {
  return request<{ org: Organization; role: OrgRole }>(`/orgs/${encodeURIComponent(id)}`);
}

export function updateOrg(id: string, body: { name: string }): Promise<{ org: Organization }> {
  return request<{ org: Organization }>(`/orgs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
  });
}

export function deleteOrg(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/orgs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function listOrgMembers(orgId: string): Promise<{ members: OrgMember[] }> {
  return request<{ members: OrgMember[] }>(`/orgs/${encodeURIComponent(orgId)}/members`);
}

export function addOrgMember(
  orgId: string,
  body: { email: string; role?: OrgRole },
): Promise<{ member: OrgMember }> {
  return request<{ member: OrgMember }>(`/orgs/${encodeURIComponent(orgId)}/members`, {
    method: 'POST',
    body,
  });
}

export function updateOrgMember(
  orgId: string,
  userId: string,
  body: { role: OrgRole },
): Promise<{ member: OrgMember }> {
  return request<{ member: OrgMember }>(
    `/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body },
  );
}

export function removeOrgMember(orgId: string, userId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export interface AuditQuery {
  limit?: number;
  offset?: number;
  action?: string;
}

export function getOrgAudit(orgId: string, q: AuditQuery = {}): Promise<AuditListResponse> {
  return request<AuditListResponse>(`/orgs/${encodeURIComponent(orgId)}/audit`, {
    query: { limit: q.limit, offset: q.offset, action: q.action },
  });
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export function listApiKeys(): Promise<{ keys: ApiKeyInfo[] }> {
  return request<{ keys: ApiKeyInfo[] }>('/api-keys');
}

export function createApiKey(body: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
  return request<CreateApiKeyResponse>('/api-keys', { method: 'POST', body });
}

export function revokeApiKey(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Audit (personal)
// ---------------------------------------------------------------------------

export function getAudit(q: AuditQuery = {}): Promise<AuditListResponse> {
  return request<AuditListResponse>('/audit', {
    query: { limit: q.limit, offset: q.offset, action: q.action },
  });
}

// ---------------------------------------------------------------------------
// Usage stats
// ---------------------------------------------------------------------------

export function getStats(range: StatsRange): Promise<StatsResponse> {
  return request<StatsResponse>('/stats', { query: { range } });
}
