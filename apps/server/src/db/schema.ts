import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
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
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
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

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose, t.createdAt),
    index('auth_tokens_expires_idx').on(t.expiresAt),
    check('auth_tokens_purpose_check', sql`${t.purpose} IN ('verify_email', 'password_reset')`),
  ],
);

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authTokenId: uuid('auth_token_id').references(() => authTokens.id, { onDelete: 'cascade' }),
    template: text('template').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('email_outbox_auth_token_unique').on(t.authTokenId).where(sql`${t.authTokenId} IS NOT NULL`),
    index('email_outbox_dispatch_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.sentAt} IS NULL AND ${t.failedAt} IS NULL`),
    index('email_outbox_provider_message_idx')
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} IS NOT NULL`),
    check(
      'email_outbox_template_check',
      sql`${t.template} IN ('verify_email', 'password_reset', 'password_changed')`,
    ),
  ],
);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
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
    check('org_members_role_check', sql`${t.role} IN ('owner', 'member')`),
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
    unique('scopes_id_org_id_unique').on(t.id, t.orgId),
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
    scopeId: uuid('scope_id').notNull(),
    userId: uuid('user_id').notNull(),
    orgId: uuid('org_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeId, t.userId] }),
    index('scope_members_user_idx').on(t.userId),
    index('scope_members_org_user_idx').on(t.orgId, t.userId),
    foreignKey({
      columns: [t.scopeId, t.orgId],
      foreignColumns: [scopes.id, scopes.orgId],
      name: 'scope_members_scope_org_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.orgId, t.userId],
      foreignColumns: [orgMembers.orgId, orgMembers.userId],
      name: 'scope_members_org_member_fk',
    }).onDelete('cascade'),
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
  (t) => [index('api_keys_user_created_idx').on(t.userId, t.createdAt.desc())],
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
    embeddingDimensions: integer('embedding_dimensions').generatedAlwaysAs(sql`vector_dims(embedding)`),
    tsv: tsvector('tsv').notNull().default(sql`to_tsvector('english', '')`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // Keep a full FK index for scope cascades, including already-soft-deleted rows.
    index('memories_scope_all_idx').on(t.scopeId),
    index('memories_scope_created_active_idx')
      .on(t.scopeId, t.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
    index('memories_tsv_active_idx').using('gin', t.tsv).where(sql`deleted_at IS NULL`),
    index('memories_tags_active_idx').using('gin', t.tags).where(sql`deleted_at IS NULL`),
    index('memories_created_active_idx').on(t.createdAt.desc()).where(sql`deleted_at IS NULL`),
    index('memories_expires_idx')
      .on(t.expiresAt)
      .where(sql`expires_at IS NOT NULL AND deleted_at IS NULL`),
    index('memories_deleted_idx').on(t.deletedAt).where(sql`deleted_at IS NOT NULL`),
    check('memories_kind_check', sql`${t.kind} IN ('explicit', 'inferred')`),
    check('memories_confidence_check', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    check('memories_sensitivity_check', sql`${t.sensitivity} IN ('low', 'normal', 'high')`),
    check('memories_embedding_pair_check', sql`(${t.embedding} IS NULL) = (${t.embeddingModel} IS NULL)`),
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
