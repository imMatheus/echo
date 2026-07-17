import type { StatsRange, UsageStats } from '@echo/shared';
import { and, count, desc, eq, gt, gte, isNull, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { accessibleScopeIdsQuery } from '@/core/access';
import { notOrgReadFanout } from '@/core/audit';
import { auditLogs, memories } from '@/db/schema';
import type { AppContext } from '@/types';

const RANGE_BUCKETS: Record<StatsRange, { granularity: 'hour' | 'day'; buckets: number }> = {
  '24h': { granularity: 'hour', buckets: 24 },
  '7d': { granularity: 'day', buckets: 7 },
  '30d': { granularity: 'day', buckets: 30 },
  '90d': { granularity: 'day', buckets: 90 },
};

/**
 * Every bucket in the range, oldest first, current (partial) bucket included.
 * Day buckets are "YYYY-MM-DD" UTC days; hour buckets are ISO instants like
 * "2026-07-14T17:00:00Z" — both match the SQL bucket expressions below.
 */
function listBuckets(granularity: 'hour' | 'day', buckets: number): string[] {
  const start = new Date();
  if (granularity === 'hour') {
    start.setUTCMinutes(0, 0, 0);
    start.setUTCHours(start.getUTCHours() - (buckets - 1));
  } else {
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (buckets - 1));
  }
  return Array.from({ length: buckets }, (_, i) => {
    const d = new Date(start);
    if (granularity === 'hour') {
      d.setUTCHours(d.getUTCHours() + i);
      return `${d.toISOString().slice(0, 13)}:00:00Z`;
    }
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

const bucketExpr = (col: PgColumn, granularity: 'hour' | 'day') =>
  granularity === 'hour'
    ? sql<string>`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24":00:00Z"')`
    : sql<string>`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

/**
 * Usage numbers for the home dashboard. Memory counts follow the same privacy
 * boundary as everything else (accessible scopes only); activity counts cover
 * events where the user is the actor, like the personal audit log.
 */
export async function getUsageStats(app: AppContext, userId: string, range: StatsRange): Promise<UsageStats> {
  const { granularity, buckets: bucketCount } = RANGE_BUCKETS[range];
  const buckets = listBuckets(granularity, bucketCount);
  const since = new Date(granularity === 'hour' ? buckets[0] : `${buckets[0]}T00:00:00Z`);

  const memoryBucket = bucketExpr(memories.createdAt, granularity);
  const auditBucket = bucketExpr(auditLogs.occurredAt, granularity);
  const activeMemory = and(
    sql`${memories.scopeId} IN (${accessibleScopeIdsQuery(userId)})`,
    isNull(memories.deletedAt),
    or(isNull(memories.expiresAt), gt(memories.expiresAt, sql`now()`)),
  );
  const inRange = and(eq(auditLogs.actorUserId, userId), gte(auditLogs.occurredAt, since), notOrgReadFanout);

  const [totalResult, memoriesOverTime, actionsOverTime, sourceApps] = await Promise.all([
    app.db.select({ count: count() }).from(memories).where(activeMemory),
    app.db
      .select({ bucket: memoryBucket, count: count() })
      .from(memories)
      .where(and(activeMemory, gte(memories.createdAt, since)))
      .groupBy(memoryBucket)
      .orderBy(memoryBucket),
    app.db
      .select({ bucket: auditBucket, action: auditLogs.action, count: count() })
      .from(auditLogs)
      .where(inRange)
      .groupBy(auditBucket, auditLogs.action)
      .orderBy(auditBucket),
    app.db
      .select({ sourceApp: auditLogs.sourceApp, count: count() })
      .from(auditLogs)
      .where(inRange)
      .groupBy(auditLogs.sourceApp)
      .orderBy(desc(count())),
  ]);

  return {
    range,
    granularity,
    buckets,
    totalMemories: totalResult[0].count,
    memoriesOverTime,
    actionsOverTime,
    sourceApps,
  };
}
