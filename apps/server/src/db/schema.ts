import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// --- Custom Postgres types not built into drizzle-orm/pg-core --------------

/** Case-insensitive text (citext extension). */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/**
 * pgvector column, intentionally dimension-less so any embedding provider works.
 * Values are exchanged as pgvector's text form, e.g. "[0.1,-2,3]".
 */
const vector = customType<{ data: string; driverData: string }>({
  dataType: () => 'vector',
});

/** Full-text search vector, maintained by the memories_tsv trigger. */
const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const tags = text('tags')
  .array()
  .notNull()
  .default(sql`'{}'`);

// --- Tables ----------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: citext('email').unique().notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index('org_members_user_idx').on(t.userId),
    check('org_members_role_check', sql`${t.role} IN ('owner', 'admin', 'member')`),
  ],
);

export const scopes = pgTable(
  'scopes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    type: text('type').notNull(),
    name: text('name').notNull(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('scopes_personal_unique').on(t.userId).where(sql`type = 'personal'`),
    uniqueIndex('scopes_org_unique').on(t.orgId).where(sql`type = 'organization'`),
    index('scopes_org_idx').on(t.orgId),
    check('scopes_type_check', sql`${t.type} IN ('personal', 'organization', 'workspace', 'team', 'project')`),
    check(
      'scopes_owner_check',
      sql`(type = 'personal' AND user_id IS NOT NULL AND org_id IS NULL) OR (type <> 'personal' AND org_id IS NOT NULL AND user_id IS NULL)`,
    ),
  ],
);

export const scopeMembers = pgTable(
  'scope_members',
  {
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeId, t.userId] }),
    index('scope_members_user_idx').on(t.userId),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sourceApp: text('source_app').notNull().default('api'),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').unique().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    kind: text('kind').notNull().default('explicit'),
    confidence: real('confidence').notNull().default(1),
    sensitivity: text('sensitivity').notNull().default('normal'),
    sourceApp: text('source_app').notNull().default('dashboard'),
    tags,
    metadata: jsonb('metadata').notNull().default(sql`'{}'`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    tsv: tsvector('tsv'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('memories_scope_idx').on(t.scopeId).where(sql`deleted_at IS NULL`),
    index('memories_tsv_idx').using('gin', t.tsv),
    index('memories_tags_idx').using('gin', t.tags),
    index('memories_created_idx').on(t.createdAt.desc()),
    check('memories_kind_check', sql`${t.kind} IN ('explicit', 'inferred')`),
    check('memories_confidence_check', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    check('memories_sensitivity_check', sql`${t.sensitivity} IN ('low', 'normal', 'high')`),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    sourceApp: text('source_app').notNull().default('dashboard'),
    action: text('action').notNull(),
    memoryId: uuid('memory_id'),
    scopeId: uuid('scope_id'),
    orgId: uuid('org_id'),
    details: jsonb('details').notNull().default(sql`'{}'`),
  },
  (t) => [
    index('audit_org_idx').on(t.orgId, t.occurredAt.desc()).where(sql`org_id IS NOT NULL`),
    index('audit_actor_idx').on(t.actorUserId, t.occurredAt.desc()),
    index('audit_memory_idx').on(t.memoryId).where(sql`memory_id IS NOT NULL`),
  ],
);
