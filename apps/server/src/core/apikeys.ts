import type { ApiKeyInfo, CreateApiKeyResponse } from '@echo/shared';
import { generateApiKey, sha256Hex } from '@/lib/crypto';
import { notFound } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';
import { logAudit } from './audit';

function mapKey(row: any): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    sourceApp: row.source_app,
    keyPrefix: row.key_prefix,
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

export async function createApiKey(
  app: AppContext,
  ctx: AuthContext,
  input: { name: string; sourceApp?: string },
): Promise<CreateApiKeyResponse> {
  const { secret, prefix, hash } = generateApiKey();
  const sourceApp = input.sourceApp?.trim() || input.name.trim().toLowerCase().replace(/\s+/g, '-');
  const { rows } = await app.db.query(
    `INSERT INTO api_keys (user_id, name, source_app, key_prefix, key_hash)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [ctx.userId, input.name, sourceApp, prefix, hash],
  );
  await logAudit(app, {
    action: 'apikey.create',
    actorUserId: ctx.userId,
    sourceApp: ctx.sourceApp,
    details: { keyName: input.name, keyPrefix: prefix },
  });
  return { key: mapKey(rows[0]), secret };
}

export async function listApiKeys(app: AppContext, userId: string): Promise<ApiKeyInfo[]> {
  const { rows } = await app.db.query('SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return rows.map(mapKey);
}

export async function revokeApiKey(app: AppContext, ctx: AuthContext, keyId: string): Promise<void> {
  const res = await app.db.query(
    'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [keyId, ctx.userId],
  );
  if (!res.rowCount) throw notFound('API key not found');
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
  const { rows } = await app.db.query(
    `SELECT k.id AS key_id, k.source_app, k.last_used_at, u.id AS user_id, u.name, u.email
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [sha256Hex(secret)],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  // Throttled last-used tracking; fire-and-forget.
  const stale = !row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000;
  if (stale) {
    app.db
      .query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.key_id])
      .catch((err) => app.log.error({ err }, 'failed to update api key last_used_at'));
  }
  return {
    keyId: row.key_id,
    sourceApp: row.source_app,
    userId: row.user_id,
    userName: row.name,
    userEmail: row.email,
  };
}
