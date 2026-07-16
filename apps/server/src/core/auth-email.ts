import type { User } from '@echo/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { authTokens, emailOutbox, sessions, users } from '@/db/schema';
import {
  authActionTokenId,
  createAuthActionToken,
  hashPassword,
  type AuthTokenPurpose,
  verifyAuthActionToken,
} from '@/lib/crypto';
import { HttpError } from '@/lib/http-error';
import type { AppContext } from '@/types';
import { logAudit } from './audit';

type DbTransaction = Parameters<Parameters<AppContext['db']['transaction']>[0]>[0];

const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const REQUEST_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const REQUEST_LIMIT_PER_WINDOW = 5;

function tokenError(purpose: AuthTokenPurpose): HttpError {
  return purpose === 'verify_email'
    ? new HttpError('verification_invalid', 'This verification link is invalid or has expired')
    : new HttpError('password_reset_invalid', 'This password reset link is invalid or has expired');
}

function mapUser(row: { id: string; email: string; name: string; createdAt: Date }): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt.toISOString() };
}

export async function queueAuthActionEmail(
  tx: DbTransaction,
  config: AppContext['config'],
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<void> {
  const generated = createAuthActionToken(config.AUTH_TOKEN_SECRET, purpose, userId);
  const ttl = purpose === 'verify_email' ? VERIFY_EMAIL_TTL_MS : PASSWORD_RESET_TTL_MS;
  await tx.insert(authTokens).values({
    id: generated.id,
    userId,
    purpose,
    tokenHash: generated.tokenHash,
    expiresAt: new Date(Date.now() + ttl),
  });
  await tx.insert(emailOutbox).values({
    userId,
    authTokenId: generated.id,
    template: purpose,
  });
}

async function invalidateActiveTokens(
  tx: DbTransaction,
  userId: string,
  purpose: AuthTokenPurpose,
  now: Date,
): Promise<void> {
  await tx.execute(sql`
    UPDATE email_outbox
    SET failed_at = ${now}, locked_at = NULL,
        last_error = 'Superseded by a newer authentication email'
    WHERE sent_at IS NULL AND failed_at IS NULL
      AND auth_token_id IN (
        SELECT id FROM auth_tokens
        WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL
      )`);
  await tx
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
}

async function queueRequestedEmail(
  app: AppContext,
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<boolean> {
  return app.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    if (!locked.rows.length) return false;
    const now = new Date();
    const [counts] = await tx
      .select({
        recent: sql<number>`count(*) FILTER (WHERE ${authTokens.createdAt} > ${new Date(now.getTime() - REQUEST_COOLDOWN_MS)})::int`,
        hourly: sql<number>`count(*) FILTER (WHERE ${authTokens.createdAt} > ${new Date(now.getTime() - REQUEST_LIMIT_WINDOW_MS)})::int`,
      })
      .from(authTokens)
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose)));
    if (Number(counts.recent) > 0 || Number(counts.hourly) >= REQUEST_LIMIT_PER_WINDOW) return false;
    await invalidateActiveTokens(tx, userId, purpose, now);
    await queueAuthActionEmail(tx, app.config, userId, purpose);
    return true;
  });
}

export async function resendEmailVerification(app: AppContext, email: string): Promise<boolean> {
  const [user] = await app.db
    .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user || user.emailVerifiedAt) return false;
  return queueRequestedEmail(app, user.id, 'verify_email');
}

export async function requestPasswordReset(app: AppContext, email: string): Promise<boolean> {
  const [user] = await app.db
    .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user?.emailVerifiedAt) return false;
  const queued = await queueRequestedEmail(app, user.id, 'password_reset');
  if (queued) {
    await logAudit(app, { action: 'auth.password_reset_requested', actorUserId: user.id });
  }
  return queued;
}

async function loadToken(app: AppContext, candidate: string, purpose: AuthTokenPurpose) {
  const id = authActionTokenId(candidate);
  if (!id) throw tokenError(purpose);
  const [row] = await app.db.select().from(authTokens).where(eq(authTokens.id, id)).limit(1);
  if (
    !row ||
    row.purpose !== purpose ||
    row.usedAt ||
    row.expiresAt <= new Date() ||
    !verifyAuthActionToken(
      candidate,
      { id: row.id, userId: row.userId, purpose, tokenHash: row.tokenHash },
      app.config.AUTH_TOKEN_SECRET,
    )
  ) {
    throw tokenError(purpose);
  }
  return row;
}

export async function verifyEmail(app: AppContext, candidate: string): Promise<User> {
  const preliminary = await loadToken(app, candidate, 'verify_email');
  const user = await app.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM auth_tokens WHERE id = ${preliminary.id} FOR UPDATE`);
    const [token] = await tx.select().from(authTokens).where(eq(authTokens.id, preliminary.id)).limit(1);
    if (
      !token ||
      token.purpose !== 'verify_email' ||
      token.usedAt ||
      token.expiresAt <= new Date() ||
      !verifyAuthActionToken(
        candidate,
        { id: token.id, userId: token.userId, purpose: 'verify_email', tokenHash: token.tokenHash },
        app.config.AUTH_TOKEN_SECRET,
      )
    ) {
      throw tokenError('verify_email');
    }
    const now = new Date();
    await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.userId, token.userId), eq(authTokens.purpose, 'verify_email'), isNull(authTokens.usedAt)));
    const [verified] = await tx
      .update(users)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, token.userId))
      .returning({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt });
    if (!verified) throw tokenError('verify_email');
    return verified;
  });
  await logAudit(app, { action: 'auth.email_verified', actorUserId: user.id });
  return mapUser(user);
}

export async function resetPassword(app: AppContext, candidate: string, password: string): Promise<void> {
  const preliminary = await loadToken(app, candidate, 'password_reset');
  const passwordHash = await hashPassword(password);
  const userId = await app.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM auth_tokens WHERE id = ${preliminary.id} FOR UPDATE`);
    const [token] = await tx.select().from(authTokens).where(eq(authTokens.id, preliminary.id)).limit(1);
    if (
      !token ||
      token.purpose !== 'password_reset' ||
      token.usedAt ||
      token.expiresAt <= new Date() ||
      !verifyAuthActionToken(
        candidate,
        { id: token.id, userId: token.userId, purpose: 'password_reset', tokenHash: token.tokenHash },
        app.config.AUTH_TOKEN_SECRET,
      )
    ) {
      throw tokenError('password_reset');
    }
    const now = new Date();
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, token.userId));
    await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.userId, token.userId), eq(authTokens.purpose, 'password_reset'), isNull(authTokens.usedAt)));
    await tx.delete(sessions).where(eq(sessions.userId, token.userId));
    await tx.insert(emailOutbox).values({ userId: token.userId, template: 'password_changed' });
    return token.userId;
  });
  await logAudit(app, { action: 'auth.password_reset', actorUserId: userId });
}
