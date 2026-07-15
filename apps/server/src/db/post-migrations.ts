import type { PoolClient, QueryResult } from 'pg';

const POST_MIGRATION = '0001_memory_cleanup_and_concurrent_indexes';
const BATCH_SIZE = 500;

export interface ConcurrentIndexSpec {
  name: string;
  sql: string;
}

/**
 * These names intentionally differ from the indexes created by 0000. That lets
 * Postgres build every replacement concurrently before the legacy index is
 * removed, without a coverage gap or a blocking in-place rebuild.
 */
export const CONCURRENT_INDEXES: readonly ConcurrentIndexSpec[] = [
  {
    name: 'api_keys_user_created_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "api_keys_user_created_idx"
          ON "public"."api_keys" USING btree ("user_id", "created_at" DESC NULLS LAST)`,
  },
  {
    name: 'memories_scope_all_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "memories_scope_all_idx"
          ON "public"."memories" USING btree ("scope_id")`,
  },
  {
    name: 'memories_scope_created_active_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "memories_scope_created_active_idx"
          ON "public"."memories" USING btree ("scope_id", "created_at" DESC NULLS LAST)
          WHERE "deleted_at" IS NULL`,
  },
  {
    name: 'memories_tsv_active_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "memories_tsv_active_idx"
          ON "public"."memories" USING gin ("tsv") WHERE "deleted_at" IS NULL`,
  },
  {
    name: 'memories_tags_active_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "memories_tags_active_idx"
          ON "public"."memories" USING gin ("tags") WHERE "deleted_at" IS NULL`,
  },
  {
    name: 'memories_created_active_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "memories_created_active_idx"
          ON "public"."memories" USING btree ("created_at" DESC NULLS LAST)
          WHERE "deleted_at" IS NULL`,
  },
  {
    name: 'memories_expires_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "memories_expires_idx"
          ON "public"."memories" USING btree ("expires_at")
          WHERE "expires_at" IS NOT NULL AND "deleted_at" IS NULL`,
  },
  {
    name: 'memories_deleted_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "memories_deleted_idx"
          ON "public"."memories" USING btree ("deleted_at") WHERE "deleted_at" IS NOT NULL`,
  },
];

export const LEGACY_INDEXES = [
  'api_keys_user_idx',
  'memories_scope_idx',
  'memories_tsv_idx',
  'memories_tags_idx',
  'memories_created_idx',
] as const;

const DELETE_SOFT_DELETED = `
  WITH batch AS MATERIALIZED (
    SELECT id FROM "public"."memories"
    WHERE ($1::uuid IS NULL OR id > $1::uuid)
    ORDER BY id
    LIMIT $2
  ), deleted AS (
    DELETE FROM "public"."memories" AS m
    USING batch
    WHERE m.id = batch.id AND m."deleted_at" IS NOT NULL
    RETURNING 1
  )
  SELECT
    (SELECT id::text FROM batch ORDER BY id DESC LIMIT 1) AS cursor,
    (SELECT count(*)::int FROM batch) AS scanned,
    (SELECT count(*)::int FROM deleted) AS affected`;

const SCRUB_AUDIT_PREVIEWS = `
  WITH batch AS MATERIALIZED (
    SELECT id FROM "public"."audit_logs"
    WHERE ($1::bigint IS NULL OR id > $1::bigint)
    ORDER BY id
    LIMIT $2
  ), updated AS (
    UPDATE "public"."audit_logs" AS a
    SET "details" = a."details" - 'contentPreview'
    FROM batch
    WHERE a.id = batch.id AND a."details" ? 'contentPreview'
    RETURNING 1
  )
  SELECT
    (SELECT id::text FROM batch ORDER BY id DESC LIMIT 1) AS cursor,
    (SELECT count(*)::int FROM batch) AS scanned,
    (SELECT count(*)::int FROM updated) AS affected`;

const NORMALIZE_API_KEY_SOURCES = `
  WITH batch AS MATERIALIZED (
    SELECT id FROM "public"."api_keys"
    WHERE ($1::uuid IS NULL OR id > $1::uuid)
    ORDER BY id
    LIMIT $2
  ), updated AS (
    UPDATE "public"."api_keys" AS k
    SET "source_app" = 'api'
    FROM batch
    WHERE k.id = batch.id AND btrim(k."source_app") = ''
    RETURNING 1
  )
  SELECT
    (SELECT id::text FROM batch ORDER BY id DESC LIMIT 1) AS cursor,
    (SELECT count(*)::int FROM batch) AS scanned,
    (SELECT count(*)::int FROM updated) AS affected`;

const NORMALIZE_MEMORY_SOURCES = `
  WITH batch AS MATERIALIZED (
    SELECT id FROM "public"."memories"
    WHERE ($1::uuid IS NULL OR id > $1::uuid)
    ORDER BY id
    LIMIT $2
  ), updated AS (
    UPDATE "public"."memories" AS m
    SET "source_app" = 'dashboard'
    FROM batch
    WHERE m.id = batch.id AND btrim(m."source_app") = ''
    RETURNING 1
  )
  SELECT
    (SELECT id::text FROM batch ORDER BY id DESC LIMIT 1) AS cursor,
    (SELECT count(*)::int FROM batch) AS scanned,
    (SELECT count(*)::int FROM updated) AS affected`;

interface CursorBatchResult {
  cursor: string | null;
  scanned: number;
  affected: number;
}

async function runCursorBatches(
  client: PoolClient,
  label: string,
  statement: string,
  log: (message: string) => void,
): Promise<void> {
  let cursor: string | null = null;
  let total = 0;
  while (true) {
    const result: QueryResult<CursorBatchResult> = await client.query<CursorBatchResult>(statement, [
      cursor,
      BATCH_SIZE,
    ]);
    const row: CursorBatchResult | undefined = result.rows[0];
    if (!row || Number(row.scanned) === 0 || !row.cursor) break;
    cursor = row.cursor;
    total += Number(row.affected);
  }
  if (total > 0) log(`${label}: ${total} rows`);
}

/** Normalize tags in primary-key order so each autocommit transaction is small. */
async function normalizeMemoryTags(client: PoolClient, log: (message: string) => void): Promise<void> {
  interface TagBatchResult {
    cursor: string | null;
    scanned: number;
    updated: number;
  }

  let cursor: string | null = null;
  let total = 0;
  while (true) {
    const result: QueryResult<TagBatchResult> = await client.query<TagBatchResult>(
      `WITH batch AS MATERIALIZED (
         SELECT id, tags
         FROM "public"."memories"
         WHERE ($1::uuid IS NULL OR id > $1::uuid)
         ORDER BY id
         LIMIT $2
         FOR UPDATE
       ), normalized AS MATERIALIZED (
         SELECT b.id, COALESCE((
           SELECT array_agg(d.tag ORDER BY d.first_ordinal)
           FROM (
             SELECT lower(btrim(u.value)) AS tag, min(u.ordinality) AS first_ordinal
             FROM unnest(b.tags) WITH ORDINALITY AS u(value, ordinality)
             WHERE btrim(u.value) <> ''
             GROUP BY lower(btrim(u.value))
           ) AS d
         ), '{}'::text[]) AS tags
         FROM batch AS b
       ), updated AS (
         UPDATE "public"."memories" AS m
         SET tags = normalized.tags
         FROM normalized
         WHERE m.id = normalized.id AND m.tags IS DISTINCT FROM normalized.tags
         RETURNING 1
       )
       SELECT
         (SELECT id::text FROM batch ORDER BY id DESC LIMIT 1) AS cursor,
         (SELECT count(*)::int FROM batch) AS scanned,
         (SELECT count(*)::int FROM updated) AS updated`,
      [cursor, BATCH_SIZE],
    );
    const row: TagBatchResult | undefined = result.rows[0];
    if (!row || Number(row.scanned) === 0 || !row.cursor) break;
    cursor = row.cursor;
    total += Number(row.updated);
  }
  if (total > 0) log(`normalized memory tags: ${total} rows`);
}

/**
 * Keep mixed-version replicas safe during a rolling deploy. The old server can
 * still write non-canonical tags, retain audit previews, or soft-delete an
 * explicit forget after the cleanup cursor has passed. Database triggers make
 * those writes conform until every replica is on the new code.
 */
async function triggerIsCurrent(
  client: PoolClient,
  name: string,
  table: string,
  functionName: string,
  triggerType: number,
  updateColumns: readonly string[],
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
     FROM pg_catalog.pg_trigger AS t
     JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
     JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
     JOIN pg_catalog.pg_namespace AS pn ON pn.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND pn.nspname = 'public'
       AND t.tgname = $1
       AND c.relname = $2
       AND p.proname = $3
       AND t.tgtype = $4
       AND t.tgenabled = 'O'
       AND t.tgqual IS NULL
       AND ARRAY(
         SELECT a.attname::text
         FROM unnest(t.tgattr::smallint[]) AS trigger_column(attnum)
         JOIN pg_catalog.pg_attribute AS a
           ON a.attrelid = t.tgrelid AND a.attnum = trigger_column.attnum
         ORDER BY a.attname
       ) = ARRAY(
         SELECT expected.column_name
         FROM unnest($5::text[]) AS expected(column_name)
         ORDER BY expected.column_name
       )
       AND NOT t.tgisinternal`,
    [name, table, functionName, triggerType, [...updateColumns]],
  );
  return result.rows.length === 1;
}

async function ensureLegacyWriteGuards(client: PoolClient, log: (message: string) => void): Promise<void> {

  // Publish the function/trigger set atomically. In particular, never expose a
  // gap between dropping the old tsv trigger and installing its replacement:
  // a crash or concurrent legacy write in that gap could leave stale search data.
  await client.query('BEGIN');
  try {
    await client.query(`
    CREATE OR REPLACE FUNCTION "public"."memories_tsv_update"() RETURNS trigger AS $$
    BEGIN
      NEW.tags := COALESCE((
        SELECT array_agg(d.tag ORDER BY d.first_ordinal)
        FROM (
          SELECT lower(btrim(u.value)) AS tag, min(u.ordinality) AS first_ordinal
          FROM unnest(NEW.tags) WITH ORDINALITY AS u(value, ordinality)
          WHERE btrim(u.value) <> ''
          GROUP BY lower(btrim(u.value))
        ) AS d
      ), '{}'::text[]);
      NEW.source_app := COALESCE(NULLIF(btrim(NEW.source_app), ''), 'dashboard');
      NEW.tsv := to_tsvector('english',
        coalesce(NEW.content, '') || ' ' || array_to_string(NEW.tags, ' '));
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql`);
    if (
      !(await triggerIsCurrent(
        client,
        'memories_tsv_trigger',
        'memories',
        'memories_tsv_update',
        23,
        ['content', 'tags', 'source_app'],
      ))
    ) {
      await client.query(`DROP TRIGGER IF EXISTS "memories_tsv_trigger" ON "public"."memories"`);
      await client.query(`
      CREATE TRIGGER "memories_tsv_trigger"
      BEFORE INSERT OR UPDATE OF content, tags, source_app ON "public"."memories"
      FOR EACH ROW EXECUTE FUNCTION "public"."memories_tsv_update"()`);
    }

    await client.query(`
    CREATE OR REPLACE FUNCTION "public"."echo_api_key_normalize"() RETURNS trigger AS $$
    BEGIN
      NEW.source_app := COALESCE(NULLIF(btrim(NEW.source_app), ''), 'api');
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql`);
    if (
      !(await triggerIsCurrent(
        client,
        'echo_api_keys_normalize_trigger',
        'api_keys',
        'echo_api_key_normalize',
        23,
        ['source_app'],
      ))
    ) {
      await client.query(`DROP TRIGGER IF EXISTS "echo_api_keys_normalize_trigger" ON "public"."api_keys"`);
      await client.query(`
      CREATE TRIGGER "echo_api_keys_normalize_trigger"
      BEFORE INSERT OR UPDATE OF source_app ON "public"."api_keys"
      FOR EACH ROW EXECUTE FUNCTION "public"."echo_api_key_normalize"()`);
    }

    await client.query(`
    CREATE OR REPLACE FUNCTION "public"."echo_audit_preview_scrub"() RETURNS trigger AS $$
    BEGIN
      NEW.details := COALESCE(NEW.details, '{}'::jsonb) - 'contentPreview';
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql`);
    if (
      !(await triggerIsCurrent(
        client,
        'echo_audit_preview_scrub_trigger',
        'audit_logs',
        'echo_audit_preview_scrub',
        23,
        ['details'],
      ))
    ) {
      await client.query(`DROP TRIGGER IF EXISTS "echo_audit_preview_scrub_trigger" ON "public"."audit_logs"`);
      await client.query(`
      CREATE TRIGGER "echo_audit_preview_scrub_trigger"
      BEFORE INSERT OR UPDATE OF details ON "public"."audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "public"."echo_audit_preview_scrub"()`);
    }

    await client.query(`
    CREATE OR REPLACE FUNCTION "public"."echo_legacy_memory_hard_delete"() RETURNS trigger AS $$
    BEGIN
      IF OLD.deleted_at IS NULL
         AND NEW.deleted_at IS NOT NULL
         AND NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
        DELETE FROM "public"."memories" WHERE id = NEW.id;
      END IF;
      RETURN NULL;
    END
    $$ LANGUAGE plpgsql`);
    if (
      !(await triggerIsCurrent(
        client,
        'echo_legacy_memory_hard_delete_trigger',
        'memories',
        'echo_legacy_memory_hard_delete',
        17,
        ['deleted_at'],
      ))
    ) {
      await client.query(`DROP TRIGGER IF EXISTS "echo_legacy_memory_hard_delete_trigger" ON "public"."memories"`);
      await client.query(`
      CREATE TRIGGER "echo_legacy_memory_hard_delete_trigger"
      AFTER UPDATE OF deleted_at ON "public"."memories"
      FOR EACH ROW EXECUTE FUNCTION "public"."echo_legacy_memory_hard_delete"()`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }

  log('rolling-deploy write guards up to date');
}

/**
 * Recover failed concurrent builds (which Postgres leaves behind as invalid),
 * build every replacement, and only then remove the legacy indexes.
 */
export async function ensureConcurrentIndexes(
  client: PoolClient,
  log: (message: string) => void = () => {},
): Promise<void> {
  for (const index of CONCURRENT_INDEXES) {
    const state = await client.query<{ isValid: boolean }>(
      `SELECT i.indisvalid AS "isValid"
       FROM pg_catalog.pg_class AS c
       JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.oid
       WHERE n.nspname = 'public' AND c.relname = $1`,
      [index.name],
    );
    if (state.rows[0] && !state.rows[0].isValid) {
      await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "public"."${index.name}"`);
    }
    await client.query(index.sql);
  }

  for (const name of LEGACY_INDEXES) {
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "public"."${name}"`);
  }
  log('concurrent indexes up to date');
}

/**
 * Drizzle migrations are transactional, while CREATE/DROP INDEX CONCURRENTLY
 * must run in autocommit mode. This resumable phase runs after Drizzle commits;
 * its marker is written last so a crash safely retries every idempotent step.
 */
export async function runPostMigrations(
  client: PoolClient,
  log: (message: string) => void = () => {},
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__echo_post_migrations" (
      name text PRIMARY KEY,
      completed_at timestamptz NOT NULL DEFAULT now()
    )`);
  // This catalog-checked guard also upgrades databases that briefly ran an
  // earlier 0001 implementation and already have the completion marker.
  await ensureLegacyWriteGuards(client, log);
  const completed = await client.query(
    `SELECT 1 FROM "drizzle"."__echo_post_migrations" WHERE name = $1`,
    [POST_MIGRATION],
  );
  if (completed.rows.length > 0) return;

  await runCursorBatches(client, 'purged legacy deleted memories', DELETE_SOFT_DELETED, log);
  await runCursorBatches(client, 'scrubbed audit previews', SCRUB_AUDIT_PREVIEWS, log);
  await normalizeMemoryTags(client, log);
  await runCursorBatches(client, 'normalized API key source apps', NORMALIZE_API_KEY_SOURCES, log);
  await runCursorBatches(client, 'normalized memory source apps', NORMALIZE_MEMORY_SOURCES, log);
  await ensureConcurrentIndexes(client, log);

  await client.query(
    `INSERT INTO "drizzle"."__echo_post_migrations" (name) VALUES ($1) ON CONFLICT DO NOTHING`,
    [POST_MIGRATION],
  );
  log(`post-migration ${POST_MIGRATION} complete`);
}
