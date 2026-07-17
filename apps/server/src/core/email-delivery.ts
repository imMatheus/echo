import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { authTokens, emailOutbox, users } from '@/db/schema';
import { renderAuthEmail, type AuthEmailTemplate } from '@/email/templates';
import { rebuildAuthActionToken, sha256Hex, type AuthTokenPurpose } from '@/lib/crypto';
import type { AppContext } from '@/types';

const MAX_ATTEMPTS = 8;
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

interface ClaimedEmail {
  id: string;
  userId: string;
  authTokenId: string | null;
  template: AuthEmailTemplate;
  attempts: number;
}

async function claimEmails(app: AppContext, limit: number): Promise<ClaimedEmail[]> {
  const staleLock = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const result = await app.db.execute(sql`
    WITH picked AS (
      SELECT outbox.id
      FROM email_outbox AS outbox
      WHERE outbox.sent_at IS NULL
        AND outbox.failed_at IS NULL
        AND outbox.next_attempt_at <= now()
        AND (outbox.locked_at IS NULL OR outbox.locked_at < ${staleLock})
        AND (
          outbox.auth_token_id IS NULL OR EXISTS (
            SELECT 1 FROM auth_tokens AS token
            WHERE token.id = outbox.auth_token_id
              AND token.used_at IS NULL
              AND token.expires_at > now()
          )
        )
      ORDER BY outbox.created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE email_outbox AS outbox
    SET locked_at = now(), attempts = outbox.attempts + 1
    FROM picked
    WHERE outbox.id = picked.id
    RETURNING outbox.id, outbox.user_id, outbox.auth_token_id, outbox.template, outbox.attempts`);
  return result.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    authTokenId: row.auth_token_id ? String(row.auth_token_id) : null,
    template: String(row.template) as AuthEmailTemplate,
    attempts: Number(row.attempts),
  }));
}

async function renderClaimedEmail(app: AppContext, claimed: ClaimedEmail) {
  const [user] = await app.db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, claimed.userId))
    .limit(1);
  if (!user) throw new Error('Email recipient no longer exists');

  let token: string | null = null;
  if (claimed.authTokenId) {
    const [stored] = await app.db.select().from(authTokens).where(eq(authTokens.id, claimed.authTokenId)).limit(1);
    if (!stored || stored.usedAt || stored.expiresAt <= new Date()) {
      throw new Error('Authentication token is no longer deliverable');
    }
    if (stored.purpose !== claimed.template) throw new Error('Email template and token purpose do not match');
    token = rebuildAuthActionToken(
      app.config.AUTH_TOKEN_SECRET,
      stored.purpose as AuthTokenPurpose,
      stored.id,
      stored.userId,
    );
    if (sha256Hex(token) !== stored.tokenHash) throw new Error('Authentication token integrity check failed');
  }

  return renderAuthEmail({
    template: claimed.template,
    name: user.name,
    email: user.email,
    token,
    appUrl: app.config.APP_URL,
    from: app.config.EMAIL_FROM,
    replyTo: app.config.EMAIL_REPLY_TO,
    idempotencyKey: `echo-email-${claimed.id}`,
  });
}

export async function processEmailOutbox(app: AppContext, limit = 10): Promise<number> {
  await app.db.execute(sql`
    UPDATE email_outbox AS outbox
    SET failed_at = now(), locked_at = NULL,
        last_error = 'Authentication token expired or was used before delivery'
    FROM auth_tokens AS token
    WHERE outbox.auth_token_id = token.id
      AND outbox.sent_at IS NULL AND outbox.failed_at IS NULL
      AND (token.used_at IS NOT NULL OR token.expires_at <= now())`);

  const claimed = await claimEmails(app, limit);
  for (const email of claimed) {
    try {
      const message = await renderClaimedEmail(app, email);
      const result = await app.email.send(message);
      await app.db
        .update(emailOutbox)
        .set({
          sentAt: new Date(),
          lockedAt: null,
          providerMessageId: result.messageId,
          lastError: null,
        })
        .where(and(eq(emailOutbox.id, email.id), isNull(emailOutbox.sentAt), isNull(emailOutbox.failedAt)));
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const failed = email.attempts >= MAX_ATTEMPTS;
      const delayMs = Math.min(60 * 60 * 1000, 15_000 * 2 ** Math.max(0, email.attempts - 1));
      await app.db
        .update(emailOutbox)
        .set({
          lockedAt: null,
          lastError: message,
          ...(failed ? { failedAt: new Date() } : { nextAttemptAt: new Date(Date.now() + delayMs) }),
        })
        .where(and(eq(emailOutbox.id, email.id), isNull(emailOutbox.sentAt), isNull(emailOutbox.failedAt)));
      app.log.error({ err: error, emailOutboxId: email.id }, 'email delivery failed');
    }
  }
  return claimed.length;
}

export async function sweepAuthEmailData(app: AppContext): Promise<void> {
  const outboxCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const tokenCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await app.db
    .delete(emailOutbox)
    .where(
      and(
        lt(emailOutbox.createdAt, outboxCutoff),
        or(sql`${emailOutbox.sentAt} IS NOT NULL`, sql`${emailOutbox.failedAt} IS NOT NULL`),
      ),
    );
  await app.db
    .delete(authTokens)
    .where(
      and(
        lt(authTokens.createdAt, tokenCutoff),
        or(sql`${authTokens.usedAt} IS NOT NULL`, lt(authTokens.expiresAt, new Date())),
      ),
    );
}
