import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSession, destroySession, getPersonalScopeId, getUserById, login, signup } from '../../core/auth.js';
import { HttpError } from '../../lib/http-error.js';
import { parse } from '../../lib/validate.js';
import type { AppContext } from '../../types.js';
import { requireAuth, SESSION_COOKIE } from '../authn.js';

const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function authRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    const setSessionCookie = async (reply: any, userId: string) => {
      const { token, expiresAt } = await createSession(app, userId);
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: app.config.secureCookies,
        expires: expiresAt,
      });
    };

    f.post('/auth/signup', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
      if (app.config.DISABLE_SIGNUP) {
        throw new HttpError('signup_disabled', 'Sign-ups are disabled on this server');
      }
      const body = parse(signupSchema, req.body);
      const user = await signup(app, body);
      await setSessionCookie(reply, user.id);
      return { user };
    });

    f.post('/auth/login', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
      const body = parse(loginSchema, req.body);
      const user = await login(app, body.email, body.password);
      await setSessionCookie(reply, user.id);
      return { user };
    });

    f.post('/auth/logout', async (req, reply) => {
      const token = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
      if (token) await destroySession(app, token);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    });

    f.get('/auth/me', async (req) => {
      const ctx = await requireAuth(app, req);
      const [personalScopeId, user] = await Promise.all([
        getPersonalScopeId(app, ctx.userId),
        getUserById(app, ctx.userId),
      ]);
      return { user, personalScopeId };
    });
  };
}
