import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { resolveApiKey } from '@/core/apikeys';
import { getSessionUser } from '@/core/auth';
import { HttpError } from '@/lib/http-error';
import { requireApiKeyAuth, requireAuth, requireSessionAuth, SESSION_COOKIE } from '@/http/authn';
import type { AppContext } from '@/types';

vi.mock('@/core/apikeys', () => ({ resolveApiKey: vi.fn() }));
vi.mock('@/core/auth', () => ({ getSessionUser: vi.fn() }));

const resolveApiKeyMock = vi.mocked(resolveApiKey);
const getSessionUserMock = vi.mocked(getSessionUser);

const app = {} as AppContext;

function makeReq(opts: { authorization?: string; cookie?: string } = {}): FastifyRequest {
  return {
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    cookies: opts.cookie ? { [SESSION_COOKIE]: opts.cookie } : {},
  } as unknown as FastifyRequest;
}

const apiKey = {
  keyId: 'key-1',
  userId: 'user-1',
  userName: 'Ada',
  userEmail: 'ada@example.com',
  sourceApp: 'claude-code',
};

const sessionUser = { id: 'user-2', name: 'Grace', email: 'grace@example.com' };

beforeEach(() => {
  resolveApiKeyMock.mockReset();
  getSessionUserMock.mockReset();
});

describe('requireAuth', () => {
  it('resolves an API-key identity from a Bearer token', async () => {
    resolveApiKeyMock.mockResolvedValue(apiKey as never);
    const auth = await requireAuth(app, makeReq({ authorization: 'Bearer eck_secret' }));
    expect(auth).toMatchObject({ userId: 'user-1', via: 'api_key', apiKeyId: 'key-1', sourceApp: 'claude-code' });
    expect(resolveApiKeyMock).toHaveBeenCalledWith(app, 'eck_secret');
  });

  it('rejects an invalid API key with 401', async () => {
    resolveApiKeyMock.mockResolvedValue(null as never);
    await expect(requireAuth(app, makeReq({ authorization: 'Bearer bad' }))).rejects.toBeInstanceOf(HttpError);
  });

  it('falls back to the session cookie and tags writes as the dashboard', async () => {
    getSessionUserMock.mockResolvedValue(sessionUser as never);
    const auth = await requireAuth(app, makeReq({ cookie: 'sess-token' }));
    expect(auth).toMatchObject({ userId: 'user-2', via: 'session', apiKeyId: null, sourceApp: 'dashboard' });
    expect(getSessionUserMock).toHaveBeenCalledWith(app, 'sess-token');
  });

  it('throws 401 when no credentials are present', async () => {
    await expect(requireAuth(app, makeReq())).rejects.toBeInstanceOf(HttpError);
    expect(resolveApiKeyMock).not.toHaveBeenCalled();
    expect(getSessionUserMock).not.toHaveBeenCalled();
  });

  it('memoizes the resolved identity per request', async () => {
    resolveApiKeyMock.mockResolvedValue(apiKey as never);
    const req = makeReq({ authorization: 'Bearer eck_secret' });
    await requireAuth(app, req);
    await requireAuth(app, req);
    expect(resolveApiKeyMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed Authorization header and returns 401', async () => {
    await expect(requireAuth(app, makeReq({ authorization: 'Basic abc' }))).rejects.toBeInstanceOf(HttpError);
    expect(resolveApiKeyMock).not.toHaveBeenCalled();
  });
});

describe('requireSessionAuth', () => {
  it('accepts a dashboard session', async () => {
    getSessionUserMock.mockResolvedValue(sessionUser as never);
    const auth = await requireSessionAuth(app, makeReq({ cookie: 'sess-token' }));
    expect(auth.via).toBe('session');
  });

  it('rejects an API-key identity', async () => {
    resolveApiKeyMock.mockResolvedValue(apiKey as never);
    await expect(requireSessionAuth(app, makeReq({ authorization: 'Bearer eck_secret' }))).rejects.toBeInstanceOf(
      HttpError,
    );
  });
});

describe('requireApiKeyAuth', () => {
  it('returns null when there is no Bearer token', async () => {
    expect(await requireApiKeyAuth(app, makeReq({ cookie: 'sess-token' }))).toBeNull();
    expect(resolveApiKeyMock).not.toHaveBeenCalled();
  });

  it('returns null for a session identity even with resolution attempted', async () => {
    getSessionUserMock.mockResolvedValue(sessionUser as never);
    expect(await requireApiKeyAuth(app, makeReq({ cookie: 'sess-token' }))).toBeNull();
  });

  it('returns the API-key identity for a valid Bearer token', async () => {
    resolveApiKeyMock.mockResolvedValue(apiKey as never);
    const auth = await requireApiKeyAuth(app, makeReq({ authorization: 'Bearer eck_secret' }));
    expect(auth?.via).toBe('api_key');
  });
});
