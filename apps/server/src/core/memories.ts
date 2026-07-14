import type {
  CreateMemoryRequest,
  ListMemoriesQuery,
  ListMemoriesResponse,
  Memory,
  MemorySearchResult,
  SearchMemoriesRequest,
  SearchMemoriesResponse,
  UpdateMemoryRequest,
} from '@echo/shared';
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { memories, scopes, sessions, users } from '@/db/schema';
import { toVectorLiteral } from '@/lib/embeddings';
import { forbidden, notFound } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';
import { getAccessibleScopes, getScopeAccess, type ScopeAccess } from './access';
import { logAudit } from './audit';

const MEMORY_COLS = `
  m.id, m.scope_id, m.content, m.kind, m.confidence, m.sensitivity, m.source_app,
  m.tags, m.metadata, m.created_by, m.embedding_model, m.expires_at, m.created_at, m.updated_at,
  s.type AS scope_type, s.name AS scope_name, s.org_id AS scope_org_id,
  u.name AS created_by_name`;

const MEMORY_JOINS = `
  JOIN scopes s ON s.id = m.scope_id
  LEFT JOIN users u ON u.id = m.created_by`;

const NOT_GONE = `m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > now())`;

interface MemoryRow extends Record<string, any> {
  scope_org_id: string | null;
}

// The query builder returns Date objects; raw `db.execute` (the hybrid-search CTE)
// returns timestamps as strings — normalize both to an ISO string.
const toIso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    scopeId: row.scope_id,
    scopeType: row.scope_type,
    scopeName: row.scope_name,
    content: row.content,
    kind: row.kind,
    confidence: Number(row.confidence),
    sensitivity: row.sensitivity,
    sourceApp: row.source_app,
    tags: row.tags ?? [],
    metadata: row.metadata ?? {},
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    embeddingModel: row.embedding_model,
    expiresAt: row.expires_at ? toIso(row.expires_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// Column set shared by the query-builder reads (fetch/list). Snake_case keys keep
// the shape mapMemory already expects.
const memorySelect = {
  id: memories.id,
  scope_id: memories.scopeId,
  content: memories.content,
  kind: memories.kind,
  confidence: memories.confidence,
  sensitivity: memories.sensitivity,
  source_app: memories.sourceApp,
  tags: memories.tags,
  metadata: memories.metadata,
  created_by: memories.createdBy,
  embedding_model: memories.embeddingModel,
  expires_at: memories.expiresAt,
  created_at: memories.createdAt,
  updated_at: memories.updatedAt,
  scope_type: scopes.type,
  scope_name: scopes.name,
  scope_org_id: scopes.orgId,
  created_by_name: users.name,
} as const;

/** `deleted_at IS NULL AND not expired` as a query-builder condition. */
const notGone = (): SQL =>
  sql`${memories.deletedAt} IS NULL AND (${memories.expiresAt} IS NULL OR ${memories.expiresAt} > now())`;

/** Embedding failures must never fail a write — the memory is stored without a vector. */
async function embedBestEffort(app: AppContext, text: string): Promise<{ vector: string; model: string } | null> {
  if (!app.embeddings) return null;
  try {
    const [embedding] = await app.embeddings.embed([text]);
    return { vector: toVectorLiteral(embedding), model: app.embeddings.modelId };
  } catch (err) {
    app.log.error({ err }, 'embedding failed; storing memory without a vector');
    return null;
  }
}

export async function createMemory(app: AppContext, ctx: AuthContext, input: CreateMemoryRequest): Promise<Memory> {
  let scope: ScopeAccess | null;
  if (input.scopeId) {
    scope = await getScopeAccess(app, ctx.userId, input.scopeId);
  } else {
    const scopes = await getAccessibleScopes(app, ctx.userId);
    scope = scopes.find((s) => s.type === 'personal') ?? null;
  }
  if (!scope) throw notFound('Scope not found');
  if (!scope.canWrite) throw forbidden('You cannot write to this scope');

  const embedded = await embedBestEffort(app, input.content);
  const [created] = await app.db
    .insert(memories)
    .values({
      scopeId: scope.id,
      content: input.content,
      kind: input.kind ?? 'explicit',
      confidence: input.confidence ?? 1,
      sensitivity: input.sensitivity ?? 'normal',
      sourceApp: input.sourceApp?.trim() || ctx.sourceApp,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      createdBy: ctx.userId,
      apiKeyId: ctx.apiKeyId,
      embedding: embedded ? sql`${embedded.vector}::vector` : null,
      embeddingModel: embedded?.model ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    })
    .returning({ id: memories.id });
  const memory = await fetchMemory(app, created.id);
  await logAudit(app, {
    action: 'memory.create',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: memory.sourceApp,
    memoryId: memory.id,
    scopeId: scope.id,
    orgId: scope.orgId,
    details: { kind: memory.kind, scopeType: scope.type },
  });
  return memory;
}

async function fetchMemory(app: AppContext, id: string): Promise<Memory> {
  const [row] = await app.db
    .select(memorySelect)
    .from(memories)
    .innerJoin(scopes, eq(scopes.id, memories.scopeId))
    .leftJoin(users, eq(users.id, memories.createdBy))
    .where(and(eq(memories.id, id), isNull(memories.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Memory not found');
  return mapMemory(row);
}

/** Memory + the caller's access to its scope; 404 when either is missing. */
async function getMemoryWithAccess(
  app: AppContext,
  ctx: AuthContext,
  id: string,
): Promise<{ memory: Memory; scope: ScopeAccess }> {
  const memory = await fetchMemory(app, id);
  const scope = await getScopeAccess(app, ctx.userId, memory.scopeId);
  if (!scope) throw notFound('Memory not found');
  return { memory, scope };
}

export async function getMemory(app: AppContext, ctx: AuthContext, id: string): Promise<Memory> {
  const { memory, scope } = await getMemoryWithAccess(app, ctx, id);
  if (ctx.via === 'api_key') {
    await logAudit(app, {
      action: 'memory.get',
      actorUserId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
      sourceApp: ctx.sourceApp,
      memoryId: id,
      scopeId: memory.scopeId,
      orgId: scope.orgId,
    });
  }
  return memory;
}

export async function listMemories(
  app: AppContext,
  ctx: AuthContext,
  query: ListMemoriesQuery,
): Promise<ListMemoriesResponse> {
  let scopeIds: string[];
  let orgId: string | null = null;
  if (query.scopeId) {
    const scope = await getScopeAccess(app, ctx.userId, query.scopeId);
    if (!scope) throw notFound('Scope not found');
    scopeIds = [scope.id];
    orgId = scope.orgId;
  } else {
    scopeIds = (await getAccessibleScopes(app, ctx.userId)).map((s) => s.id);
  }
  if (scopeIds.length === 0) return { memories: [], total: 0 };

  const conditions: SQL[] = [inArray(memories.scopeId, scopeIds), notGone()];
  if (query.q) conditions.push(ilike(memories.content, `%${query.q}%`));
  if (query.kind) conditions.push(eq(memories.kind, query.kind));
  if (query.sensitivity) conditions.push(eq(memories.sensitivity, query.sensitivity));
  if (query.sourceApp) conditions.push(eq(memories.sourceApp, query.sourceApp));
  if (query.tag) conditions.push(sql`${query.tag} = ANY(${memories.tags})`);
  const where = and(...conditions);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  const [totalRes, rows] = await Promise.all([
    app.db.select({ n: count() }).from(memories).where(where),
    app.db
      .select(memorySelect)
      .from(memories)
      .innerJoin(scopes, eq(scopes.id, memories.scopeId))
      .leftJoin(users, eq(users.id, memories.createdBy))
      .where(where)
      .orderBy(desc(memories.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  if (ctx.via === 'api_key') {
    await logAudit(app, {
      action: 'memory.list',
      actorUserId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
      sourceApp: ctx.sourceApp,
      scopeId: query.scopeId ?? null,
      orgId,
      details: { count: rows.length, filters: { scopeId: query.scopeId, kind: query.kind, tag: query.tag } },
    });
  }
  return { memories: rows.map(mapMemory), total: totalRes[0].n };
}

const RRF_K = 60;
const CANDIDATES = 60;

export async function searchMemories(
  app: AppContext,
  ctx: AuthContext,
  req: SearchMemoriesRequest,
): Promise<SearchMemoriesResponse> {
  const accessible = await getAccessibleScopes(app, ctx.userId);
  let scopeIds = accessible.map((s) => s.id);
  if (req.scopeIds && req.scopeIds.length > 0) {
    const allowed = new Set(scopeIds);
    const rejected = req.scopeIds.filter((id) => !allowed.has(id));
    if (rejected.length > 0) throw notFound(`Scope not found: ${rejected[0]}`);
    scopeIds = req.scopeIds;
  }
  const limit = Math.min(Math.max(req.limit ?? 8, 1), 50);
  if (scopeIds.length === 0 || !req.query.trim()) return { results: [], mode: app.embeddings ? 'hybrid' : 'fts' };

  const embedded = await embedBestEffort(app, req.query);
  let rows: MemoryRow[];
  // Bind the scope ids as a single Postgres array literal: interpolating a JS array
  // into a raw `sql` template spreads it into separate params, which breaks `= ANY(...)`.
  const scopeArray = `{${scopeIds.join(',')}}`;

  // OR-semantics tsquery: recall queries are descriptions of what's needed, not
  // exact phrases, so any-term matching with rank ordering beats plainto's AND.
  const tsq = (q: string): SQL => sql`
    SELECT CASE WHEN plainto_tsquery('english', ${q})::text = '' THEN NULL
                ELSE to_tsquery('english', replace(plainto_tsquery('english', ${q})::text, ' & ', ' | '))
           END AS tsq`;

  if (embedded) {
    const result = await app.db.execute(
      sql`WITH q AS (${tsq(req.query)}),
       base AS (
         SELECT m.id, m.embedding, m.embedding_model, m.tsv FROM memories m
         WHERE m.scope_id = ANY(${scopeArray}::uuid[]) AND ${sql.raw(NOT_GONE)}
       ),
       vec AS (
         SELECT id, (1 - (embedding <=> ${embedded.vector}::vector))::float8 AS similarity,
                row_number() OVER (ORDER BY embedding <=> ${embedded.vector}::vector) AS rnk
         FROM base
         WHERE embedding IS NOT NULL AND embedding_model = ${embedded.model}
         ORDER BY embedding <=> ${embedded.vector}::vector
         LIMIT ${CANDIDATES}
       ),
       fts AS (
         SELECT b.id, row_number() OVER (ORDER BY ts_rank_cd(b.tsv, q.tsq) DESC, b.id) AS rnk
         FROM base b, q
         WHERE q.tsq IS NOT NULL AND b.tsv @@ q.tsq
         ORDER BY ts_rank_cd(b.tsv, q.tsq) DESC
         LIMIT ${CANDIDATES}
       ),
       merged AS (
         SELECT COALESCE(v.id, f.id) AS id,
                (COALESCE(1.0 / (${RRF_K} + v.rnk), 0) + COALESCE(1.0 / (${RRF_K} + f.rnk), 0))::float8 AS score,
                v.similarity
         FROM vec v FULL OUTER JOIN fts f ON f.id = v.id
       )
       SELECT ${sql.raw(MEMORY_COLS)}, mg.score, mg.similarity
       FROM merged mg JOIN memories m ON m.id = mg.id ${sql.raw(MEMORY_JOINS)}
       ORDER BY mg.score DESC, m.created_at DESC
       LIMIT ${limit}`,
    );
    rows = result.rows as MemoryRow[];
  } else {
    const result = await app.db.execute(
      sql`WITH q AS (${tsq(req.query)}),
       fts AS (
         SELECT m.id, row_number() OVER (ORDER BY ts_rank_cd(m.tsv, q.tsq) DESC, m.id) AS rnk
         FROM memories m, q
         WHERE m.scope_id = ANY(${scopeArray}::uuid[]) AND ${sql.raw(NOT_GONE)}
           AND q.tsq IS NOT NULL AND m.tsv @@ q.tsq
         ORDER BY ts_rank_cd(m.tsv, q.tsq) DESC
         LIMIT ${CANDIDATES}
       )
       SELECT ${sql.raw(MEMORY_COLS)}, (1.0 / (${RRF_K} + fts.rnk))::float8 AS score, NULL::float8 AS similarity
       FROM fts JOIN memories m ON m.id = fts.id ${sql.raw(MEMORY_JOINS)}
       ORDER BY fts.rnk
       LIMIT ${limit}`,
    );
    rows = result.rows as MemoryRow[];
  }

  const results: MemorySearchResult[] = rows.map((row) => ({
    ...mapMemory(row),
    score: Number(row.score),
    similarity: row.similarity == null ? null : Number(row.similarity),
  }));

  // Actor-level audit keeps the query; per-org rows omit it (queries can carry
  // personal information the org has no right to see).
  const byOrg = new Map<string, string[]>();
  for (const row of rows) {
    if (row.scope_org_id) {
      const list = byOrg.get(row.scope_org_id) ?? [];
      list.push(row.id);
      byOrg.set(row.scope_org_id, list);
    }
  }
  await Promise.all([
    logAudit(app, {
      action: 'memory.recall',
      actorUserId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
      sourceApp: ctx.sourceApp,
      details: { query: req.query, count: results.length, mode: embedded ? 'hybrid' : 'fts' },
    }),
    ...[...byOrg].map(([orgId, memoryIds]) =>
      logAudit(app, {
        action: 'memory.recall',
        actorUserId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
        sourceApp: ctx.sourceApp,
        orgId,
        details: { count: memoryIds.length, memoryIds },
      }),
    ),
  ]);

  return { results, mode: embedded ? 'hybrid' : 'fts' };
}

function canModify(ctx: AuthContext, memory: Memory, scope: ScopeAccess): boolean {
  return memory.createdBy === ctx.userId || scope.canManage;
}

export async function updateMemory(
  app: AppContext,
  ctx: AuthContext,
  id: string,
  input: UpdateMemoryRequest,
): Promise<Memory> {
  const { memory, scope } = await getMemoryWithAccess(app, ctx, id);
  if (!canModify(ctx, memory, scope)) {
    throw forbidden('Only the memory creator or a scope manager can edit this memory');
  }

  let targetScope = scope;
  if (input.scopeId && input.scopeId !== memory.scopeId) {
    const next = await getScopeAccess(app, ctx.userId, input.scopeId);
    if (!next) throw notFound('Target scope not found');
    if (!next.canWrite) throw forbidden('You cannot write to the target scope');
    targetScope = next;
  }

  const set: PgUpdateSetSource<typeof memories> = { updatedAt: sql`now()` };
  if (input.content !== undefined && input.content !== memory.content) {
    set.content = input.content;
    const embedded = await embedBestEffort(app, input.content);
    set.embedding = embedded ? sql`${embedded.vector}::vector` : null;
    set.embeddingModel = embedded?.model ?? null;
  }
  if (input.kind !== undefined) set.kind = input.kind;
  if (input.confidence !== undefined) set.confidence = input.confidence;
  if (input.sensitivity !== undefined) set.sensitivity = input.sensitivity;
  if (input.tags !== undefined) set.tags = input.tags;
  if (input.metadata !== undefined) set.metadata = input.metadata;
  if (input.expiresAt !== undefined) set.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (targetScope.id !== memory.scopeId) set.scopeId = targetScope.id;

  // Only updated_at present → nothing actually changed.
  if (Object.keys(set).length === 1) return memory;
  await app.db.update(memories).set(set).where(eq(memories.id, id));

  const updated = await fetchMemory(app, id);
  await logAudit(app, {
    action: 'memory.update',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    memoryId: id,
    scopeId: updated.scopeId,
    orgId: targetScope.orgId,
    details: { fields: Object.keys(input) },
  });
  return updated;
}

export async function deleteMemory(app: AppContext, ctx: AuthContext, id: string): Promise<void> {
  const { memory, scope } = await getMemoryWithAccess(app, ctx, id);
  if (!canModify(ctx, memory, scope)) {
    throw forbidden('Only the memory creator or a scope manager can delete this memory');
  }
  await app.db
    .update(memories)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(memories.id, id));
  await logAudit(app, {
    action: 'memory.delete',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    memoryId: id,
    scopeId: memory.scopeId,
    orgId: scope.orgId,
    details: { contentPreview: memory.content.slice(0, 80) },
  });
}

/** Housekeeping: soft-delete expired memories, purge soft-deleted rows after 30 days. */
export async function sweepMemories(app: AppContext): Promise<void> {
  await app.db
    .update(memories)
    .set({ deletedAt: sql`now()` })
    .where(and(isNotNull(memories.expiresAt), sql`${memories.expiresAt} <= now()`, isNull(memories.deletedAt)));
  await app.db
    .delete(memories)
    .where(and(isNotNull(memories.deletedAt), sql`${memories.deletedAt} < now() - interval '30 days'`));
  await app.db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
}
