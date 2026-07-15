import type { User } from '@echo/shared';
import { and, eq, sql } from 'drizzle-orm';
import { scopes, sessions, users } from '@/db/schema';
import { generateSessionToken, hashPassword, sha256Hex, verifyPassword } from '@/lib/crypto';
import { conflict, unauthorized } from '@/lib/http-error';
import { isUniqueViolation } from '@/lib/postgres';
import type { AppContext } from '@/types';
import { logAudit } from './audit';

type UserRow = typeof users.$inferSelect;

export function mapUser(row: Pick<UserRow, 'id' | 'email' | 'name' | 'createdAt'>): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function signup(
  app: AppContext,
  input: { email: string; password: string; name: string },
): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  let user: UserRow;
  try {
    // The unique constraint, rather than a racy preflight SELECT, arbitrates
    // concurrent signups for the same case-insensitive email.
    user = await app.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email: input.email, name: input.name, passwordHash })
        .returning();
      await tx.insert(scopes).values({ type: 'personal', name: 'Personal', userId: created.id });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_unique')) {
      throw conflict('An account with that email already exists');
    }
    throw error;
  }
  await logAudit(app, { action: 'auth.signup', actorUserId: user.id, details: { email: user.email } });
  return mapUser(user);
}

// Precomputed once so unknown-email logins cost exactly one scrypt verify,
// matching the known-email path (uniform timing, no wasted hashing per attempt).
const DUMMY_HASH = hashPassword('invalid-password-placeholder');

export async function login(app: AppContext, email: string, password: string): Promise<User> {
  const [row] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);
  // Verify against a dummy hash on unknown emails to keep timing uniform.
  const ok = row
    ? await verifyPassword(password, row.passwordHash)
    : await verifyPassword(password, await DUMMY_HASH).then(() => false);
  if (!row || !ok) throw unauthorized('Invalid email or password');
  await logAudit(app, { action: 'auth.login', actorUserId: row.id });
  return mapUser(row);
}

export async function createSession(app: AppContext, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + app.config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await app.db.insert(sessions).values({ tokenHash: sha256Hex(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(app: AppContext, token: string): Promise<User | null> {
  const [row] = await app.db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), sql`${sessions.expiresAt} > now()`))
    .limit(1);
  return row ? mapUser(row) : null;
}

export async function destroySession(app: AppContext, token: string): Promise<void> {
  await app.db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}

export async function getUserById(app: AppContext, userId: string): Promise<User> {
  const [row] = await app.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw unauthorized('Account no longer exists');
  return mapUser(row);
}

export async function getPersonalScopeId(app: AppContext, userId: string): Promise<string> {
  const [row] = await app.db
    .select({ id: scopes.id })
    .from(scopes)
    .where(and(eq(scopes.type, 'personal'), eq(scopes.userId, userId)))
    .limit(1);
  if (!row) {
    // Self-heal for accounts created before personal scopes existed.
    const [created] = await app.db
      .insert(scopes)
      .values({ type: 'personal', name: 'Personal', userId })
      .onConflictDoNothing()
      .returning({ id: scopes.id });
    if (created) return created.id;
    // A concurrent request won the partial unique-index race.
    const [winner] = await app.db
      .select({ id: scopes.id })
      .from(scopes)
      .where(and(eq(scopes.type, 'personal'), eq(scopes.userId, userId)))
      .limit(1);
    if (winner) return winner.id;
    throw unauthorized('Account no longer exists');
  }
  return row.id;
}
