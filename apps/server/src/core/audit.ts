import type { AuditEntry, AuditListResponse } from '@echo/shared';
import { and, count, desc, eq, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { apiKeys, auditLogs, users } from '@/db/schema';
import { escapeLikePattern } from '@/lib/sql';
import type { AppContext } from '@/types';

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

/** Per-organization read rows support org auditing but must not double-count the actor's activity. */
export const notOrgReadFanout = sql`
  NOT (
    ${auditLogs.orgId} IS NOT NULL
    AND (
      ${auditLogs.action} = 'memory.recall'
      OR (
        ${auditLogs.action} = 'memory.list'
        AND coalesce(${auditLogs.details} ->> 'orgFanout', 'false') = 'true'
      )
    )
  )`;

function auditRow(event: AuditEvent): typeof auditLogs.$inferInsert {
  return {
    action: event.action,
    actorUserId: event.actorUserId ?? null,
    apiKeyId: event.apiKeyId ?? null,
    sourceApp: event.sourceApp ?? 'dashboard',
    memoryId: event.memoryId ?? null,
    scopeId: event.scopeId ?? null,
    orgId: event.orgId ?? null,
    details: event.details ?? {},
  };
}

/** Best-effort batch append; auditing must never fail the operation being audited. */
export async function logAuditMany(app: AppContext, events: AuditEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await app.db.insert(auditLogs).values(events.map(auditRow));
  } catch (err) {
    app.log.error({ err, eventCount: events.length }, 'failed to write audit log');
  }
}

/** Best-effort single append. */
export function logAudit(app: AppContext, event: AuditEvent): Promise<void> {
  return logAuditMany(app, [event]);
}

interface AuditQuery {
  limit: number;
  offset: number;
  action?: string;
}

interface AuditRow {
  id: bigint;
  occurredAt: Date;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  apiKeyName: string | null;
  sourceApp: string;
  memoryId: string | null;
  scopeId: string | null;
  orgId: string | null;
  details: unknown;
}

function mapEntry(row: AuditRow): AuditEntry {
  return {
    id: String(row.id),
    occurredAt: row.occurredAt.toISOString(),
    action: row.action,
    actorUserId: row.actorUserId,
    actorName: row.actorName ?? null,
    apiKeyName: row.apiKeyName ?? null,
    sourceApp: row.sourceApp,
    memoryId: row.memoryId,
    scopeId: row.scopeId,
    orgId: row.orgId,
    details: (row.details as Record<string, unknown>) ?? {},
  };
}

async function listAudit(
  app: AppContext,
  filterColumn: PgColumn,
  filterValue: string,
  q: AuditQuery,
  extraCondition?: SQL,
): Promise<AuditListResponse> {
  const where = and(
    eq(filterColumn, filterValue),
    extraCondition,
    q.action
      ? sql`${auditLogs.action} ILIKE ${`%${escapeLikePattern(q.action)}%`} ESCAPE E'\\\\'`
      : undefined,
  );
  const [totalRes, rows] = await Promise.all([
    app.db.select({ n: count() }).from(auditLogs).where(where),
    app.db
      .select({
        id: auditLogs.id,
        occurredAt: auditLogs.occurredAt,
        action: auditLogs.action,
        actorUserId: auditLogs.actorUserId,
        sourceApp: auditLogs.sourceApp,
        memoryId: auditLogs.memoryId,
        scopeId: auditLogs.scopeId,
        orgId: auditLogs.orgId,
        details: auditLogs.details,
        actorName: users.name,
        apiKeyName: apiKeys.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .leftJoin(apiKeys, eq(apiKeys.id, auditLogs.apiKeyId))
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(q.limit)
      .offset(q.offset),
  ]);
  return { entries: rows.map(mapEntry), total: totalRes[0].n };
}

/** Events where the given user is the actor. */
export function listUserAudit(app: AppContext, userId: string, q: AuditQuery): Promise<AuditListResponse> {
  return listAudit(app, auditLogs.actorUserId, userId, q, notOrgReadFanout);
}

/** Org-scoped events only — personal memories never carry an org_id, so they never show here. */
export function listOrgAudit(app: AppContext, orgId: string, q: AuditQuery): Promise<AuditListResponse> {
  return listAudit(app, auditLogs.orgId, orgId, q);
}
