import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createDb, migrate } from '../src/db';

const baseUrl = new URL(process.env.DATABASE_URL || 'postgres://echo:echo@localhost:5433/echo');
const databaseName = `echo_upgrade_${process.pid}_${Date.now()}`;
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${databaseName}`;

const admin = new Client({ connectionString: adminUrl.toString() });
let created = false;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;

  const legacy = new Client({ connectionString: testUrl.toString() });
  try {
    await legacy.connect();
    const migrationPath = join(dirname(fileURLToPath(import.meta.url)), '../drizzle/0000_init.sql');
    const migrationSql = await readFile(migrationPath, 'utf8');
    for (const statement of migrationSql.split('--> statement-breakpoint')) {
      if (statement.trim()) await legacy.query(statement);
    }

    // Mark only 0000 complete so the real migrator applies every upgrade migration.
    await legacy.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await legacy.query(`
      CREATE TABLE drizzle.__drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`);
    await legacy.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
       VALUES ('schema-upgrade-fixture', 1783986772590)`,
    );

    const user = await legacy.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, 'Legacy Owner', 'unused')
       RETURNING id`,
      [`legacy-owner-${databaseName}@example.com`],
    );
    const org = await legacy.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, created_by)
       VALUES ('Legacy Organization', $1, $2)
       RETURNING id`,
      [`legacy-${databaseName}`, user.rows[0].id],
    );
    await legacy.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member')`,
      [org.rows[0].id, user.rows[0].id],
    );
    const legacyAdmin = await legacy.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, 'Legacy Admin', 'unused')
       RETURNING id`,
      [`legacy-admin-${databaseName}@example.com`],
    );
    await legacy.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [org.rows[0].id, legacyAdmin.rows[0].id],
    );
    const scope = await legacy.query<{ id: string }>(
      `INSERT INTO scopes (type, name, org_id)
       VALUES ('organization', 'Legacy Organization', $1)
       RETURNING id`,
      [org.rows[0].id],
    );
    const memory = await legacy.query<{ id: string }>(
      `INSERT INTO memories (scope_id, content, created_by, embedding)
       VALUES ($1, 'legacy searchable content', $2, '[1,0]'::vector)
       RETURNING id`,
      [scope.rows[0].id, user.rows[0].id],
    );
    await legacy.query(`INSERT INTO scope_members (scope_id, user_id) VALUES ($1, $2)`, [
      scope.rows[0].id,
      user.rows[0].id,
    ]);
    await legacy.query('UPDATE memories SET tsv = NULL WHERE id = $1', [memory.rows[0].id]);
  } finally {
    await legacy.end().catch(() => {});
  }

  const db = createDb(testUrl.toString(), () => {});
  try {
    await migrate(db);
  } finally {
    await db.$client.end();
  }

  const verified = new Client({ connectionString: testUrl.toString() });
  try {
    await verified.connect();
    // Simulate an old replica after the migration commits: the compatibility
    // trigger must fill org_id for its legacy two-column insert.
    await verified.query('DELETE FROM scope_members');
    await verified.query(
      `INSERT INTO scope_members (scope_id, user_id)
       SELECT scope.id, member.user_id
       FROM scopes AS scope
       JOIN org_members AS member ON member.org_id = scope.org_id
       LIMIT 1`,
    );
    const result = await verified.query<{
      migrationCount: number;
      ownerRole: string;
      adminDemoted: boolean;
      tsvRebuilt: boolean;
      embeddingCleared: boolean;
      scopeMembershipRepaired: boolean;
      legacyUsersVerified: boolean;
    }>(`
      SELECT
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS "migrationCount",
        (SELECT member.role FROM org_members AS member
         JOIN users AS u ON u.id = member.user_id
         WHERE u.name = 'Legacy Owner') AS "ownerRole",
        (SELECT member.role = 'member' FROM org_members AS member
         JOIN users AS u ON u.id = member.user_id
         WHERE u.name = 'Legacy Admin') AS "adminDemoted",
        (SELECT tsv IS NOT NULL FROM memories LIMIT 1) AS "tsvRebuilt",
        (SELECT embedding IS NULL AND embedding_model IS NULL AND embedding_dimensions IS NULL
         FROM memories LIMIT 1) AS "embeddingCleared",
        (SELECT member.org_id = scope.org_id
         FROM scope_members AS member
         JOIN scopes AS scope ON scope.id = member.scope_id
         LIMIT 1) AS "scopeMembershipRepaired",
        (SELECT bool_and(email_verified_at = created_at) FROM users) AS "legacyUsersVerified"`);
    const state = result.rows[0];
    if (
      !state ||
      state.migrationCount !== 7 ||
      state.ownerRole !== 'owner' ||
      !state.adminDemoted ||
      !state.tsvRebuilt ||
      !state.embeddingCleared ||
      !state.scopeMembershipRepaired ||
      !state.legacyUsersVerified
    ) {
      throw new Error(`schema upgrade repair failed: ${JSON.stringify(state)}`);
    }
  } finally {
    await verified.end().catch(() => {});
  }

  console.log('schema upgrade smoke: legacy ownership, search, embedding, and scope membership repaired');
} finally {
  if (created) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});
}
