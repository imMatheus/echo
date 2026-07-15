import type { FastifyRequest } from 'fastify';
import { resolveApiKey } from '@/core/apikeys';
import { getSessionUser } from '@/core/auth';
import { unauthorized } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';

export const SESSION_COOKIE = 'echo_session';

const AUTH_CACHE = Symbol('echo.auth');

function bearerSecret(header: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim() || null;
}

async function resolveAuth(app: AppContext, req: FastifyRequest): Promise<AuthContext | null> {
  const secret = bearerSecret(req.headers.authorization);
  if (secret) {
    const key = await resolveApiKey(app, secret);
    if (!key) return null;
    return {
      userId: key.userId,
      userName: key.userName,
      userEmail: key.userEmail,
      via: 'api_key',
      apiKeyId: key.keyId,
      sourceApp: key.sourceApp,
    };
  }
  const token = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
  if (token) {
    const user = await getSessionUser(app, token);
    if (!user) return null;
    return {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      via: 'session',
      apiKeyId: null,
      sourceApp: 'dashboard',
    };
  }
  return null;
}

/** Memoized per request; throws 401 when neither a valid session nor API key is present. */
export async function requireAuth(app: AppContext, req: FastifyRequest): Promise<AuthContext> {
  const holder = req as FastifyRequest & { [AUTH_CACHE]?: AuthContext | null };
  if (holder[AUTH_CACHE] === undefined) {
    holder[AUTH_CACHE] = await resolveAuth(app, req);
  }
  const auth = holder[AUTH_CACHE];
  if (!auth) throw unauthorized();
  return auth;
}

/** Credential management is deliberately dashboard-session-only. */
export async function requireSessionAuth(app: AppContext, req: FastifyRequest): Promise<AuthContext> {
  const auth = await requireAuth(app, req);
  if (auth.via !== 'session') {
    throw unauthorized('A dashboard session is required to manage API keys');
  }
  return auth;
}

/** API-key-only variant used by the MCP endpoint. Returns null instead of throwing. */
export async function requireApiKeyAuth(app: AppContext, req: FastifyRequest): Promise<AuthContext | null> {
  if (!bearerSecret(req.headers.authorization)) return null;
  const auth = await resolveAuth(app, req);
  return auth?.via === 'api_key' ? auth : null;
}
