import type { AuditEntry, AuditListResponse } from '@echo/shared';
import type { AppContext } from '../types.js';

export interface AuditEvent {
  action: string;
  actorUserId?: string | null;
  apiKeyId?: string | null;
  sourceApp?: string;
  memoryId?: string | null;
  scopeId?: string | null;
  orgId?: string | null;
  details?: Record<string, unknown>;
}

/** Best-effort append; auditing must never fail the operation being audited. */
export async function logAudit(app: AppContext, event: AuditEvent): Promise<void> {
  try {
    await app.db.query(
      `INSERT INTO audit_logs (action, actor_user_id, api_key_id, source_app, memory_id, scope_id, org_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.action,
        event.actorUserId ?? null,
        event.apiKeyId ?? null,
        event.sourceApp ?? 'dashboard',
        event.memoryId ?? null,
        event.scopeId ?? null,
        event.orgId ?? null,
        JSON.stringify(event.details ?? {}),
      ],
    );
  } catch (err) {
    app.log.error({ err }, 'failed to write audit log');
  }
}

interface AuditQuery {
  limit: number;
  offset: number;
  action?: string;
}

function mapEntry(row: any): AuditEntry {
  return {
    id: String(row.id),
    occurredAt: row.occurred_at.toISOString(),
    action: row.action,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name ?? null,
    apiKeyName: row.api_key_name ?? null,
    sourceApp: row.source_app,
    memoryId: row.memory_id,
    scopeId: row.scope_id,
    orgId: row.org_id,
    details: row.details ?? {},
  };
}

const BASE_SELECT = `
  SELECT a.*, u.name AS actor_name, k.name AS api_key_name
  FROM audit_logs a
  LEFT JOIN users u ON u.id = a.actor_user_id
  LEFT JOIN api_keys k ON k.id = a.api_key_id`;

/** Events where the given user is the actor. */
export async function listUserAudit(app: AppContext, userId: string, q: AuditQuery): Promise<AuditListResponse> {
  const params: unknown[] = [userId];
  let where = 'WHERE a.actor_user_id = $1';
  if (q.action) {
    params.push(`%${q.action}%`);
    where += ` AND a.action ILIKE $${params.length}`;
  }
  const total = await app.db.query(`SELECT count(*)::int AS n FROM audit_logs a ${where}`, params);
  params.push(q.limit, q.offset);
  const { rows } = await app.db.query(
    `${BASE_SELECT} ${where} ORDER BY a.occurred_at DESC, a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { entries: rows.map(mapEntry), total: total.rows[0].n };
}

/** Org-scoped events only — personal memories never carry an org_id, so they never show here. */
export async function listOrgAudit(app: AppContext, orgId: string, q: AuditQuery): Promise<AuditListResponse> {
  const params: unknown[] = [orgId];
  let where = 'WHERE a.org_id = $1';
  if (q.action) {
    params.push(`%${q.action}%`);
    where += ` AND a.action ILIKE $${params.length}`;
  }
  const total = await app.db.query(`SELECT count(*)::int AS n FROM audit_logs a ${where}`, params);
  params.push(q.limit, q.offset);
  const { rows } = await app.db.query(
    `${BASE_SELECT} ${where} ORDER BY a.occurred_at DESC, a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { entries: rows.map(mapEntry), total: total.rows[0].n };
}
