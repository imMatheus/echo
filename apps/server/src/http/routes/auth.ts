import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createSession, destroySession, getPersonalScopeId, getUserById, login, signup } from '@/core/auth';
import { requestPasswordReset, resendEmailVerification, resetPassword, verifyEmail } from '@/core/auth-email';
import { kickEmailOutbox } from '@/core/email-delivery';
import { HttpError } from '@/lib/http-error';
import { displayName, emailAddress, password } from '@/lib/schemas';
import { parse } from '@/lib/validate';
import type { AppContext } from '@/types';
import { requireAuth, SESSION_COOKIE } from '@/http/authn';

const signupSchema = z.object({
  email: emailAddress,
  password,
  name: displayName,
});

const loginSchema = z.object({
  email: emailAddress,
  password: z.string().min(1).max(128),
});

const emailSchema = z.object({ email: emailAddress });
const tokenSchema = z.object({ token: z.string().trim().min(1).max(512) });
const resetPasswordSchema = tokenSchema.extend({ password });

const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const EMAIL_AUTH_RATE_LIMIT = { rateLimit: { max: 5, timeWindow: '1 minute' } };

async function minimumResponseTime(startedAt: number, minimumMs = 250): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export function authRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    const setSessionCookie = async (reply: FastifyReply, userId: string) => {
      const { token, expiresAt } = await createSession(app, userId);
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: app.config.COOKIE_SAME_SITE,
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
      kickEmailOutbox(app);
      return { verificationRequired: true as const, email: user.email };
    });

    f.post('/auth/verify-email', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
      const body = parse(tokenSchema, req.body);
      const user = await verifyEmail(app, body.token);
      await setSessionCookie(reply, user.id);
      return { user };
    });

    f.post('/auth/resend-verification', { config: EMAIL_AUTH_RATE_LIMIT }, async (req) => {
      const startedAt = Date.now();
      const body = parse(emailSchema, req.body);
      const queued = await resendEmailVerification(app, body.email);
      await minimumResponseTime(startedAt);
      if (queued) {
        kickEmailOutbox(app);
      }
      return { ok: true as const };
    });

    f.post('/auth/login', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
      const body = parse(loginSchema, req.body);
      const user = await login(app, body.email, body.password);
      await setSessionCookie(reply, user.id);
      return { user };
    });

    f.post('/auth/forgot-password', { config: EMAIL_AUTH_RATE_LIMIT }, async (req) => {
      const startedAt = Date.now();
      const body = parse(emailSchema, req.body);
      const queued = await requestPasswordReset(app, body.email);
      await minimumResponseTime(startedAt);
      if (queued) {
        kickEmailOutbox(app);
      }
      return { ok: true as const };
    });

    f.post('/auth/reset-password', { config: EMAIL_AUTH_RATE_LIMIT }, async (req, reply) => {
      const body = parse(resetPasswordSchema, req.body);
      await resetPassword(app, body.token, body.password);
      kickEmailOutbox(app);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true as const };
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
