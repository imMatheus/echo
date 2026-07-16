import type { ApiKeyInfo, CreateApiKeyResponse } from '@echo/shared';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { apiKeys, users } from '@/db/schema';
import { generateApiKey, sha256Hex } from '@/lib/crypto';
import { notFound } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';
import { logAudit } from './audit';

type ApiKeyRow = typeof apiKeys.$inferSelect;

type PublicApiKeyRow = Pick<
  ApiKeyRow,
  'id' | 'name' | 'sourceApp' | 'keyPrefix' | 'lastUsedAt' | 'createdAt' | 'revokedAt'
>;

const publicApiKeySelect = {
  id: apiKeys.id,
  name: apiKeys.name,
  sourceApp: apiKeys.sourceApp,
  keyPrefix: apiKeys.keyPrefix,
  lastUsedAt: apiKeys.lastUsedAt,
  createdAt: apiKeys.createdAt,
  revokedAt: apiKeys.revokedAt,
} as const;

function mapKey(row: PublicApiKeyRow): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    sourceApp: row.sourceApp,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

export async function createApiKey(
  app: AppContext,
  ctx: AuthContext,
  input: { name: string; sourceApp?: string },
): Promise<CreateApiKeyResponse> {
  const { secret, prefix, hash } = generateApiKey();
  // The explicit sourceApp is route-bounded to 64 characters. Keep the same
  // invariant for the name-derived fallback used when callers omit it.
  const sourceApp = (
    input.sourceApp?.trim() || input.name.trim().toLowerCase().replace(/\s+/g, '-')
  ).slice(0, 64);
  const [row] = await app.db
    .insert(apiKeys)
    .values({ userId: ctx.userId, name: input.name, sourceApp, keyPrefix: prefix, keyHash: hash })
    .returning(publicApiKeySelect);
  await logAudit(app, {
    action: 'apikey.create',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    details: { keyName: input.name, keyPrefix: prefix },
  });
  return { key: mapKey(row), secret };
}

export async function listApiKeys(app: AppContext, userId: string): Promise<ApiKeyInfo[]> {
  const rows = await app.db
    .select(publicApiKeySelect)
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(mapKey);
}

export async function revokeApiKey(app: AppContext, ctx: AuthContext, keyId: string): Promise<void> {
  const revoked = await app.db
    .update(apiKeys)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, ctx.userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (!revoked.length) throw notFound('API key not found');
  await logAudit(app, {
    action: 'apikey.revoke',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    details: { keyId },
  });
}

export interface ResolvedApiKey {
  keyId: string;
  sourceApp: string;
  userId: string;
  userName: string;
  userEmail: string;
}

export async function resolveApiKey(app: AppContext, secret: string): Promise<ResolvedApiKey | null> {
  const [row] = await app.db
    .select({
      keyId: apiKeys.id,
      sourceApp: apiKeys.sourceApp,
      lastUsedAt: apiKeys.lastUsedAt,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(
      and(eq(apiKeys.keyHash, sha256Hex(secret)), isNull(apiKeys.revokedAt), isNotNull(users.emailVerifiedAt)),
    )
    .limit(1);
  if (!row) return null;
  // Throttled last-used tracking; fire-and-forget.
  const stale = !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000;
  if (stale) {
    app.db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      // Re-check staleness in the UPDATE so a burst of concurrent requests
      // does not turn one per-minute heartbeat into one write per request.
      .where(
        and(
          eq(apiKeys.id, row.keyId),
          sql`(${apiKeys.lastUsedAt} IS NULL OR ${apiKeys.lastUsedAt} < now() - interval '1 minute')`,
        ),
      )
      .catch((err) => app.log.error({ err }, 'failed to update api key last_used_at'));
  }
  return {
    keyId: row.keyId,
    sourceApp: row.sourceApp,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
  };
}
