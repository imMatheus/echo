/**
 * Shared types (and small cross-package utilities) for Echo — the open
 * context layer for AI apps.
 *
 * The types describe the REST API surface exactly as the server returns it
 * (camelCase JSON). The dashboard, the MCP stdio bridge, and any third-party
 * client can rely on them.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SCOPE_TYPES = ['personal', 'organization', 'workspace', 'team', 'project'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** Scope types that can be created inside an organization. */
export const ORG_SCOPE_TYPES = ['workspace', 'team', 'project'] as const;
export type OrgScopeType = (typeof ORG_SCOPE_TYPES)[number];

export const MEMORY_KINDS = ['explicit', 'inferred'] as const;
/** 'explicit' = the user asked for it to be remembered; 'inferred' = a model wrote it on its own. */
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const SENSITIVITIES = ['low', 'normal', 'high'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

// ---------------------------------------------------------------------------
// Core resources
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface OrganizationWithRole extends Organization {
  role: OrgRole;
  memberCount: number;
}

export interface Scope {
  id: string;
  type: ScopeType;
  name: string;
  /** Set for org-owned scopes (organization/workspace/team/project). */
  orgId: string | null;
  /** Set for personal scopes. */
  userId: string | null;
  createdAt: string;
}

export interface ScopeWithAccess extends Scope {
  orgName: string | null;
  /** Whether the current user can create memories in this scope. */
  canWrite: boolean;
  /** Whether the current user can manage the scope (members, deletion, any memory). */
  canManage: boolean;
  memoryCount: number;
}

export interface Memory {
  id: string;
  scopeId: string;
  scopeType: ScopeType;
  scopeName: string;
  content: string;
  kind: MemoryKind;
  /** 0..1 — how confident the writer was. Explicit user statements should be 1. */
  confidence: number;
  sensitivity: Sensitivity;
  /** Which app wrote the memory (e.g. "claude-code", "cursor", "dashboard"). */
  sourceApp: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdByName: string | null;
  /** Provider:model that produced the stored embedding, or null if none. */
  embeddingModel: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult extends Memory {
  /** Combined relevance score (reciprocal-rank fusion of vector + full-text). Higher is better. */
  score: number;
  /** Cosine similarity from vector search, when semantic search participated. */
  similarity: number | null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  /** Default source-app label attached to memories written with this key. */
  sourceApp: string;
  /** First characters of the key, for display (e.g. "eck_a1b2..."). */
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface OrgMember {
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  joinedAt: string;
}

export interface ScopeMember {
  userId: string;
  email: string;
  name: string;
  addedAt: string;
}

export interface AuditEntry {
  id: string;
  occurredAt: string;
  /** e.g. "memory.create", "memory.recall", "memory.delete", "apikey.create", "org.member_add" */
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  /** Name of the API key used, when the action came through an API key. */
  apiKeyName: string | null;
  sourceApp: string;
  memoryId: string | null;
  scopeId: string | null;
  orgId: string | null;
  details: Record<string, unknown>;
}

export interface ServerMeta {
  name: string;
  version: string;
  signupEnabled: boolean;
  /** null when no embedding provider is configured (search falls back to full-text). */
  embeddings: { provider: string; model: string } | null;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateMemoryRequest {
  content: string;
  /** Defaults to the caller's personal scope. */
  scopeId?: string;
  kind?: MemoryKind;
  confidence?: number;
  sensitivity?: Sensitivity;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** ISO timestamp after which the memory is no longer returned. */
  expiresAt?: string | null;
  /** Overrides the default source app (session = "dashboard", API key = key's sourceApp). */
  sourceApp?: string;
}

export interface UpdateMemoryRequest {
  content?: string;
  kind?: MemoryKind;
  confidence?: number;
  sensitivity?: Sensitivity;
  tags?: string[];
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
  /** Move the memory to another scope the caller can write to. */
  scopeId?: string;
}

export interface SearchMemoriesRequest {
  query: string;
  /** Restrict to these scopes; defaults to every scope the caller can read. */
  scopeIds?: string[];
  /** Max results, default 8, max 50. */
  limit?: number;
}

export interface ListMemoriesQuery {
  scopeId?: string;
  /** Case-insensitive substring filter on content. */
  q?: string;
  kind?: MemoryKind;
  sensitivity?: Sensitivity;
  sourceApp?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface CreateOrgRequest {
  name: string;
  slug?: string;
}

export interface CreateScopeRequest {
  orgId: string;
  type: OrgScopeType;
  name: string;
}

export interface CreateApiKeyRequest {
  name: string;
  sourceApp?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface MeResponse {
  user: User;
  personalScopeId: string;
}

export interface ListMemoriesResponse {
  memories: Memory[];
  total: number;
}

export interface SearchMemoriesResponse {
  results: MemorySearchResult[];
  /** 'hybrid' when an embedding provider participated, otherwise 'fts'. */
  mode: 'hybrid' | 'fts';
}

export interface CreateApiKeyResponse {
  key: ApiKeyInfo;
  /** Full secret, shown exactly once at creation time. */
  secret: string;
}

export interface AuditListResponse {
  entries: AuditEntry[];
  total: number;
}

export interface ApiError {
  error: {
    code:
      | 'unauthorized'
      | 'forbidden'
      | 'not_found'
      | 'validation_error'
      | 'conflict'
      | 'rate_limited'
      | 'signup_disabled'
      | 'internal_error';
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** URL-friendly org slug: lowercased, diacritics stripped, non-alphanumerics dashed. */
export function slugify(name: string): string {
  const stripped = [...name.toLowerCase().normalize('NFKD')]
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp < 0x300 || cp > 0x36f; // drop combining diacritics left by NFKD
    })
    .join('');
  return (
    stripped
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  );
}
