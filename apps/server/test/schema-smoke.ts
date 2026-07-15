import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL ?? 'postgres://echo:echo@localhost:5433/echo';
const client = new Client({
  connectionString,
});

const expectedTriggers = {
  memories_tsv_trigger: {
    tableName: 'memories',
    functionName: 'memories_tsv_update',
    triggerType: 23,
    updateColumns: ['content', 'source_app', 'tags'],
  },
  echo_api_keys_normalize_trigger: {
    tableName: 'api_keys',
    functionName: 'echo_api_key_normalize',
    triggerType: 23,
    updateColumns: ['source_app'],
  },
  echo_audit_preview_scrub_trigger: {
    tableName: 'audit_logs',
    functionName: 'echo_audit_preview_scrub',
    triggerType: 23,
    updateColumns: ['details'],
  },
  echo_legacy_memory_hard_delete_trigger: {
    tableName: 'memories',
    functionName: 'echo_legacy_memory_hard_delete',
    triggerType: 17,
    updateColumns: ['deleted_at'],
  },
  echo_org_members_owner_lock_trigger: {
    tableName: 'org_members',
    functionName: 'echo_lock_org_owner_change',
    triggerType: 31,
    updateColumns: ['org_id', 'role'],
  },
  echo_scope_members_org_fill_trigger: {
    tableName: 'scope_members',
    functionName: 'echo_scope_member_set_org',
    triggerType: 23,
    updateColumns: ['org_id', 'scope_id'],
  },
} as const;

try {
  await client.connect();

  const integrity = await client.query<{
    ownerless: number;
    dimensionMismatches: number;
    missingSearchVectors: number;
    invalidScopeMemberships: number;
  }>(`
    SELECT
      (SELECT count(*)::int
       FROM organizations AS org
       WHERE NOT EXISTS (
         SELECT 1 FROM org_members AS member
         WHERE member.org_id = org.id AND member.role = 'owner'
       )) AS "ownerless",
      (SELECT count(*)::int
       FROM memories
       WHERE embedding_dimensions IS DISTINCT FROM vector_dims(embedding)) AS "dimensionMismatches",
      (SELECT count(*)::int FROM memories WHERE tsv IS NULL) AS "missingSearchVectors",
      (SELECT count(*)::int
       FROM scope_members AS member
       JOIN scopes AS scope ON scope.id = member.scope_id
       WHERE member.org_id IS DISTINCT FROM scope.org_id
          OR NOT EXISTS (
            SELECT 1 FROM org_members AS org_member
            WHERE org_member.org_id = member.org_id
              AND org_member.user_id = member.user_id
          )) AS "invalidScopeMemberships"`);

  const state = integrity.rows[0];
  if (
    !state ||
    state.ownerless !== 0 ||
    state.dimensionMismatches !== 0 ||
    state.missingSearchVectors !== 0 ||
    state.invalidScopeMemberships !== 0
  ) {
    throw new Error(`schema integrity check failed: ${JSON.stringify(state)}`);
  }

  const triggerResult = await client.query<{
    name: keyof typeof expectedTriggers;
    tableName: string;
    functionName: string;
    triggerType: number;
    enabled: string;
    hasWhen: boolean;
    updateColumns: string[];
  }>(
    `SELECT t.tgname AS name,
            c.relname AS "tableName",
            p.proname AS "functionName",
            t.tgtype::int AS "triggerType",
            t.tgenabled AS enabled,
            (t.tgqual IS NOT NULL) AS "hasWhen",
            ARRAY(
              SELECT a.attname::text
              FROM unnest(t.tgattr::smallint[]) AS trigger_column(attnum)
              JOIN pg_catalog.pg_attribute AS a
                ON a.attrelid = t.tgrelid AND a.attnum = trigger_column.attnum
              ORDER BY a.attname
            ) AS "updateColumns"
     FROM pg_catalog.pg_trigger AS t
     JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
     JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
     WHERE n.nspname = 'public'
       AND t.tgname = ANY($1::text[])
       AND NOT t.tgisinternal`,
    [Object.keys(expectedTriggers)],
  );
  const triggersByName = new Map(triggerResult.rows.map((row) => [row.name, row]));
  for (const [name, expected] of Object.entries(expectedTriggers)) {
    const actual = triggersByName.get(name as keyof typeof expectedTriggers);
    const isCurrent =
      actual?.tableName === expected.tableName &&
      actual.functionName === expected.functionName &&
      actual.triggerType === expected.triggerType &&
      actual.enabled === 'O' &&
      !actual.hasWhen &&
      JSON.stringify(actual.updateColumns) === JSON.stringify(expected.updateColumns);
    if (!isCurrent) {
      throw new Error(`trigger ${name} is stale or missing: ${JSON.stringify(actual)}`);
    }
  }

  await client.query('BEGIN');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await client.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, 'Schema Guard', 'unused')
     RETURNING id`,
    [`schema-guard-${suffix}@example.com`],
  );
  const org = await client.query<{ id: string }>(
    `INSERT INTO organizations (name, created_by)
     VALUES ('Schema Guard', $1)
     RETURNING id`,
    [user.rows[0].id],
  );
  await client.query(
    `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [org.rows[0].id, user.rows[0].id],
  );
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  await client.query(`UPDATE org_members SET role = 'member' WHERE org_id = $1 AND user_id = $2`, [
    org.rows[0].id,
    user.rows[0].id,
  ]);

  let rejected = false;
  try {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) {
    const postgresError = error as { code?: string; constraint?: string };
    rejected = postgresError.code === '23514' && postgresError.constraint === 'org_members_owner_required';
  }
  await client.query('ROLLBACK');
  if (!rejected) throw new Error('ownerless organization transaction was not rejected by the database');

  // Prove the database-level invariant also survives concurrent direct DML.
  // The second owner demotion must wait on the first transaction's org lock;
  // after the first commits, its deferred assertion must reject the second.
  const fixtureSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await client.query('BEGIN');
  const fixtureUsers = await client.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, 'Schema Guard A', 'unused'), ($2, 'Schema Guard B', 'unused')
     RETURNING id`,
    [`schema-guard-a-${fixtureSuffix}@example.com`, `schema-guard-b-${fixtureSuffix}@example.com`],
  );
  const fixtureOrg = await client.query<{ id: string }>(
    `INSERT INTO organizations (name, created_by)
     VALUES ('Concurrent Schema Guard', $1)
     RETURNING id`,
    [fixtureUsers.rows[0].id],
  );
  await client.query(
    `INSERT INTO org_members (org_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'owner')`,
    [fixtureOrg.rows[0].id, fixtureUsers.rows[0].id, fixtureUsers.rows[1].id],
  );
  await client.query('COMMIT');

  const first = new Client({ connectionString });
  const second = new Client({ connectionString });
  let concurrentRejected = false;
  try {
    await Promise.all([first.connect(), second.connect()]);
    await first.query(`SET statement_timeout = '5s'`);
    await second.query(`SET statement_timeout = '5s'`);
    const secondPid = await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`UPDATE org_members SET role = 'member' WHERE org_id = $1 AND user_id = $2`, [
      fixtureOrg.rows[0].id,
      fixtureUsers.rows[0].id,
    ]);

    let secondSettled = false;
    let secondError: unknown;
    const secondUpdate = second
      .query(`UPDATE org_members SET role = 'member' WHERE org_id = $1 AND user_id = $2`, [
        fixtureOrg.rows[0].id,
        fixtureUsers.rows[1].id,
      ])
      .catch((error) => {
        secondError = error;
      })
      .finally(() => {
        secondSettled = true;
      });

    let observedLock = false;
    for (let attempt = 0; attempt < 100 && !secondSettled; attempt += 1) {
      const activity = await client.query<{ waitEventType: string | null }>(
        `SELECT wait_event_type AS "waitEventType" FROM pg_stat_activity WHERE pid = $1`,
        [secondPid.rows[0].pid],
      );
      if (activity.rows[0]?.waitEventType === 'Lock') {
        observedLock = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!observedLock) throw new Error('concurrent owner mutations were not serialized on the organization');

    await first.query('COMMIT');
    await secondUpdate;
    if (secondError) throw secondError;
    try {
      await second.query('COMMIT');
    } catch (error) {
      const postgresError = error as { code?: string; constraint?: string };
      concurrentRejected = postgresError.code === '23514' && postgresError.constraint === 'org_members_owner_required';
    }
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    await Promise.all([first.end().catch(() => {}), second.end().catch(() => {})]);
    await client.query('DELETE FROM organizations WHERE id = $1', [fixtureOrg.rows[0].id]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixtureUsers.rows.map((row) => row.id)]);
  }
  if (!concurrentRejected) throw new Error('concurrent last-owner demotion was not rejected by the database');

  console.log('schema smoke: ownership, trigger, and embedding invariants verified');
} finally {
  await client.end().catch(() => {});
}
