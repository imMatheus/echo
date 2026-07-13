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

function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    scopeId: row.scope_id,
    scopeType: row.scope_type,
    scopeName: row.scope_name,
    content: row.content,
    kind: row.kind,
    confidence: row.confidence,
    sensitivity: row.sensitivity,
    sourceApp: row.source_app,
    tags: row.tags ?? [],
    metadata: row.metadata ?? {},
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    embeddingModel: row.embedding_model,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

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
  const { rows } = await app.db.query(
    `INSERT INTO memories
       (scope_id, content, kind, confidence, sensitivity, source_app, tags, metadata,
        created_by, api_key_id, embedding, embedding_model, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12, $13)
     RETURNING id`,
    [
      scope.id,
      input.content,
      input.kind ?? 'explicit',
      input.confidence ?? 1,
      input.sensitivity ?? 'normal',
      input.sourceApp?.trim() || ctx.sourceApp,
      input.tags ?? [],
      JSON.stringify(input.metadata ?? {}),
      ctx.userId,
      ctx.apiKeyId,
      embedded?.vector ?? null,
      embedded?.model ?? null,
      input.expiresAt ?? null,
    ],
  );
  const memory = await fetchMemory(app, rows[0].id);
  await logAudit(app, {
    action: 'memory.create',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: input.sourceApp?.trim() || ctx.sourceApp,
    memoryId: memory.id,
    scopeId: scope.id,
    orgId: scope.orgId,
    details: { kind: memory.kind, scopeType: scope.type },
  });
  return memory;
}

async function fetchMemory(app: AppContext, id: string): Promise<Memory> {
  const { rows } = await app.db.query(
    `SELECT ${MEMORY_COLS} FROM memories m ${MEMORY_JOINS} WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [id],
  );
  if (!rows[0]) throw notFound('Memory not found');
  return mapMemory(rows[0]);
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

  const params: unknown[] = [scopeIds];
  const conditions = [`m.scope_id = ANY($1::uuid[])`, NOT_GONE];
  if (query.q) {
    params.push(`%${query.q}%`);
    conditions.push(`m.content ILIKE $${params.length}`);
  }
  if (query.kind) {
    params.push(query.kind);
    conditions.push(`m.kind = $${params.length}`);
  }
  if (query.sensitivity) {
    params.push(query.sensitivity);
    conditions.push(`m.sensitivity = $${params.length}`);
  }
  if (query.sourceApp) {
    params.push(query.sourceApp);
    conditions.push(`m.source_app = $${params.length}`);
  }
  if (query.tag) {
    params.push(query.tag);
    conditions.push(`$${params.length} = ANY(m.tags)`);
  }
  const where = conditions.join(' AND ');
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  const totalRes = await app.db.query(`SELECT count(*)::int AS n FROM memories m WHERE ${where}`, params);
  params.push(limit, offset);
  const { rows } = await app.db.query(
    `SELECT ${MEMORY_COLS} FROM memories m ${MEMORY_JOINS}
     WHERE ${where}
     ORDER BY m.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

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
  return { memories: rows.map(mapMemory), total: totalRes.rows[0].n };
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

  // OR-semantics tsquery: recall queries are descriptions of what's needed, not
  // exact phrases, so any-term matching with rank ordering beats plainto's AND.
  const TSQ = `
    SELECT CASE WHEN plainto_tsquery('english', %Q)::text = '' THEN NULL
                ELSE to_tsquery('english', replace(plainto_tsquery('english', %Q)::text, ' & ', ' | '))
           END AS tsq`;

  if (embedded) {
    const { rows: r } = await app.db.query(
      `WITH q AS (${TSQ.replaceAll('%Q', '$4')}),
       base AS (
         SELECT m.id, m.embedding, m.embedding_model, m.tsv FROM memories m
         WHERE m.scope_id = ANY($1::uuid[]) AND ${NOT_GONE}
       ),
       vec AS (
         SELECT id, (1 - (embedding <=> $2::vector))::float8 AS similarity,
                row_number() OVER (ORDER BY embedding <=> $2::vector) AS rnk
         FROM base
         WHERE embedding IS NOT NULL AND embedding_model = $3
         ORDER BY embedding <=> $2::vector
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
       SELECT ${MEMORY_COLS}, mg.score, mg.similarity
       FROM merged mg JOIN memories m ON m.id = mg.id ${MEMORY_JOINS}
       ORDER BY mg.score DESC, m.created_at DESC
       LIMIT $5`,
      [scopeIds, embedded.vector, embedded.model, req.query, limit],
    );
    rows = r;
  } else {
    const { rows: r } = await app.db.query(
      `WITH q AS (${TSQ.replaceAll('%Q', '$2')}),
       fts AS (
         SELECT m.id, row_number() OVER (ORDER BY ts_rank_cd(m.tsv, q.tsq) DESC, m.id) AS rnk
         FROM memories m, q
         WHERE m.scope_id = ANY($1::uuid[]) AND ${NOT_GONE}
           AND q.tsq IS NOT NULL AND m.tsv @@ q.tsq
         ORDER BY ts_rank_cd(m.tsv, q.tsq) DESC
         LIMIT ${CANDIDATES}
       )
       SELECT ${MEMORY_COLS}, (1.0 / (${RRF_K} + fts.rnk))::float8 AS score, NULL::float8 AS similarity
       FROM fts JOIN memories m ON m.id = fts.id ${MEMORY_JOINS}
       ORDER BY fts.rnk
       LIMIT $3`,
      [scopeIds, req.query, limit],
    );
    rows = r;
  }

  const results: MemorySearchResult[] = rows.map((row) => ({
    ...mapMemory(row),
    score: row.score,
    similarity: row.similarity ?? null,
  }));

  // Actor-level audit keeps the query; per-org rows omit it (queries can carry
  // personal information the org has no right to see).
  await logAudit(app, {
    action: 'memory.recall',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    details: { query: req.query, count: results.length, mode: embedded ? 'hybrid' : 'fts' },
  });
  const byOrg = new Map<string, string[]>();
  for (const row of rows) {
    if (row.scope_org_id) {
      const list = byOrg.get(row.scope_org_id) ?? [];
      list.push(row.id);
      byOrg.set(row.scope_org_id, list);
    }
  }
  for (const [orgId, memoryIds] of byOrg) {
    await logAudit(app, {
      action: 'memory.recall',
      actorUserId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
      sourceApp: ctx.sourceApp,
      orgId,
      details: { count: memoryIds.length, memoryIds },
    });
  }

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

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [];
  const push = (fragment: string, value: unknown) => {
    params.push(value);
    sets.push(`${fragment} $${params.length}`);
  };

  if (input.content !== undefined && input.content !== memory.content) {
    push('content =', input.content);
    const embedded = await embedBestEffort(app, input.content);
    push('embedding =', embedded?.vector ?? null);
    sets[sets.length - 1] += '::vector';
    push('embedding_model =', embedded?.model ?? null);
  }
  if (input.kind !== undefined) push('kind =', input.kind);
  if (input.confidence !== undefined) push('confidence =', input.confidence);
  if (input.sensitivity !== undefined) push('sensitivity =', input.sensitivity);
  if (input.tags !== undefined) push('tags =', input.tags);
  if (input.metadata !== undefined) push('metadata =', JSON.stringify(input.metadata));
  if (input.expiresAt !== undefined) push('expires_at =', input.expiresAt);
  if (targetScope.id !== memory.scopeId) push('scope_id =', targetScope.id);

  if (sets.length === 1) return memory;
  params.push(id);
  await app.db.query(`UPDATE memories SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

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
  await app.db.query('UPDATE memories SET deleted_at = now(), updated_at = now() WHERE id = $1', [id]);
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
  await app.db.query(
    `UPDATE memories SET deleted_at = now() WHERE expires_at IS NOT NULL AND expires_at <= now() AND deleted_at IS NULL`,
  );
  await app.db.query(`DELETE FROM memories WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'`);
  await app.db.query(`DELETE FROM sessions WHERE expires_at < now()`);
}
