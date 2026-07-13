import type { ScopeType, ScopeWithAccess } from '@echo/shared';
import type { AppContext } from '../types.js';

/**
 * Access rules (the privacy boundary of the whole system):
 *  - personal scopes are visible ONLY to their owner — never to coworkers or org admins;
 *  - the organization scope is visible to every member of the org;
 *  - workspace/team/project scopes are visible to their scope members, plus org
 *    owners/admins (who manage them);
 *  - canManage (edit members, delete scope, moderate any memory) = scope owner for
 *    personal, org owner/admin for org-owned scopes.
 */
export interface ScopeAccess {
  id: string;
  type: ScopeType;
  name: string;
  orgId: string | null;
  orgName: string | null;
  userId: string | null;
  createdAt: Date;
  canWrite: boolean;
  canManage: boolean;
  memoryCount: number;
}

const ACCESS_SELECT = `
  SELECT s.id, s.type, s.name, s.org_id, s.user_id, s.created_at,
         o.name AS org_name,
         om.role AS org_role,
         (sm.user_id IS NOT NULL) AS is_scope_member,
         (SELECT count(*)::int FROM memories m
            WHERE m.scope_id = s.id AND m.deleted_at IS NULL
              AND (m.expires_at IS NULL OR m.expires_at > now())) AS memory_count
  FROM scopes s
  LEFT JOIN organizations o ON o.id = s.org_id
  LEFT JOIN org_members om ON om.org_id = s.org_id AND om.user_id = $1
  LEFT JOIN scope_members sm ON sm.scope_id = s.id AND sm.user_id = $1`;

const ACCESS_WHERE = `
  ((s.type = 'personal' AND s.user_id = $1)
   OR (om.user_id IS NOT NULL
       AND (s.type = 'organization' OR sm.user_id IS NOT NULL OR om.role IN ('owner', 'admin'))))`;

function mapAccess(row: any): ScopeAccess {
  const isPersonal = row.type === 'personal';
  const isOrgAdmin = row.org_role === 'owner' || row.org_role === 'admin';
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    orgId: row.org_id,
    orgName: row.org_name,
    userId: row.user_id,
    createdAt: row.created_at,
    canWrite: true, // every readable scope is writable in v1
    canManage: isPersonal || isOrgAdmin,
    memoryCount: row.memory_count,
  };
}

export async function getAccessibleScopes(app: AppContext, userId: string): Promise<ScopeAccess[]> {
  const { rows } = await app.db.query(
    `${ACCESS_SELECT} WHERE ${ACCESS_WHERE}
     ORDER BY (s.type = 'personal') DESC, o.name NULLS FIRST, (s.type = 'organization') DESC, s.name`,
    [userId],
  );
  return rows.map(mapAccess);
}

/** null when the scope doesn't exist OR the user cannot see it (indistinguishable on purpose). */
export async function getScopeAccess(app: AppContext, userId: string, scopeId: string): Promise<ScopeAccess | null> {
  const { rows } = await app.db.query(`${ACCESS_SELECT} WHERE s.id = $2 AND ${ACCESS_WHERE}`, [userId, scopeId]);
  return rows[0] ? mapAccess(rows[0]) : null;
}

export function toScopeWithAccess(s: ScopeAccess): ScopeWithAccess {
  return {
    id: s.id,
    type: s.type,
    name: s.name,
    orgId: s.orgId,
    orgName: s.orgName,
    userId: s.userId,
    createdAt: s.createdAt.toISOString(),
    canWrite: s.canWrite,
    canManage: s.canManage,
    memoryCount: s.memoryCount,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve an MCP-friendly scope selector: undefined/"personal" → personal scope,
 * a UUID → that scope (if accessible), anything else → unique case-insensitive
 * name match among accessible scopes ("Acme" or "Acme/Platform Team" for
 * org-qualified names).
 */
export async function resolveScopeSelector(
  app: AppContext,
  userId: string,
  selector: string | undefined,
): Promise<{ scope: ScopeAccess | null; error?: string }> {
  const scopes = await getAccessibleScopes(app, userId);
  if (!selector || selector.toLowerCase() === 'personal') {
    return { scope: scopes.find((s) => s.type === 'personal') ?? null };
  }
  if (UUID_RE.test(selector)) {
    return { scope: scopes.find((s) => s.id === selector) ?? null };
  }
  const needle = selector.toLowerCase();
  const matches = scopes.filter(
    (s) =>
      s.name.toLowerCase() === needle ||
      `${(s.orgName ?? '').toLowerCase()}/${s.name.toLowerCase()}` === needle,
  );
  if (matches.length === 1) return { scope: matches[0] };
  if (matches.length > 1) {
    return {
      scope: null,
      error: `Scope name "${selector}" is ambiguous. Matches: ${matches
        .map((m) => `${m.orgName ? `${m.orgName}/` : ''}${m.name} (${m.id})`)
        .join(', ')}. Use the scope id.`,
    };
  }
  return {
    scope: null,
    error: `No accessible scope named "${selector}". Available: ${scopes
      .map((s) => `${s.orgName ? `${s.orgName}/` : ''}${s.name} [${s.type}]`)
      .join(', ')}`,
  };
}
