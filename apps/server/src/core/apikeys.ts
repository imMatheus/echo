import type { ApiKeyInfo, CreateApiKeyResponse } from '@echo/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { apiKeys, users } from '@/db/schema';
import { generateApiKey, sha256Hex } from '@/lib/crypto';
import { notFound } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';
import { logAudit } from './audit';

type ApiKeyRow = typeof apiKeys.$inferSelect;

function mapKey(row: ApiKeyRow): ApiKeyInfo {
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
  const sourceApp = input.sourceApp?.trim() || input.name.trim().toLowerCase().replace(/\s+/g, '-');
  const [row] = await app.db
    .insert(apiKeys)
    .values({ userId: ctx.userId, name: input.name, sourceApp, keyPrefix: prefix, keyHash: hash })
    .returning();
  await logAudit(app, {
    action: 'apikey.create',
    actorUserId: ctx.userId,
    sourceApp: ctx.sourceApp,
    details: { keyName: input.name, keyPrefix: prefix },
  });
  return { key: mapKey(row), secret };
}

export async function listApiKeys(app: AppContext, userId: string): Promise<ApiKeyInfo[]> {
  const rows = await app.db
    .select()
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
    .where(and(eq(apiKeys.keyHash, sha256Hex(secret)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  // Throttled last-used tracking; fire-and-forget.
  const stale = !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000;
  if (stale) {
    app.db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(apiKeys.id, row.keyId))
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
