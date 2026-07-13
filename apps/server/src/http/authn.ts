import type { FastifyRequest } from 'fastify';
import { resolveApiKey } from '../core/apikeys.js';
import { getSessionUser } from '../core/auth.js';
import { unauthorized } from '../lib/http-error.js';
import type { AppContext, AuthContext } from '../types.js';

export const SESSION_COOKIE = 'echo_session';

const AUTH_CACHE = Symbol('echo.auth');

async function resolveAuth(app: AppContext, req: FastifyRequest): Promise<AuthContext | null> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const secret = header.slice('Bearer '.length).trim();
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

/** API-key-only variant used by the MCP endpoint. Returns null instead of throwing. */
export async function requireApiKeyAuth(app: AppContext, req: FastifyRequest): Promise<AuthContext | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const auth = await resolveAuth(app, req);
  return auth?.via === 'api_key' ? auth : null;
}
