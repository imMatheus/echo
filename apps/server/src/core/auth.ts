import type { User } from '@echo/shared';
import { generateSessionToken, hashPassword, sha256Hex, verifyPassword } from '../lib/crypto.js';
import { conflict, unauthorized } from '../lib/http-error.js';
import type { AppContext } from '../types.js';
import { logAudit } from './audit.js';

export function mapUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at.toISOString(),
  };
}

export async function signup(
  app: AppContext,
  input: { email: string; password: string; name: string },
): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  const client = await app.db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [input.email]);
    if (existing.rowCount) {
      throw conflict('An account with that email already exists');
    }
    const { rows } = await client.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *`,
      [input.email, input.name, passwordHash],
    );
    const user = rows[0];
    await client.query(`INSERT INTO scopes (type, name, user_id) VALUES ('personal', 'Personal', $1)`, [user.id]);
    await client.query('COMMIT');
    await logAudit(app, { action: 'auth.signup', actorUserId: user.id, details: { email: user.email } });
    return mapUser(user);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function login(app: AppContext, email: string, password: string): Promise<User> {
  const { rows } = await app.db.query('SELECT * FROM users WHERE email = $1', [email]);
  const row = rows[0];
  // Verify against a dummy hash on unknown emails to keep timing uniform.
  const ok = row
    ? await verifyPassword(password, row.password_hash)
    : await verifyPassword(password, await hashPassword('invalid-password-placeholder')).then(() => false);
  if (!row || !ok) throw unauthorized('Invalid email or password');
  await logAudit(app, { action: 'auth.login', actorUserId: row.id });
  return mapUser(row);
}

export async function createSession(app: AppContext, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + app.config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await app.db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256Hex(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function getSessionUser(app: AppContext, token: string): Promise<User | null> {
  const { rows } = await app.db.query(
    `SELECT u.* FROM sessions se JOIN users u ON u.id = se.user_id
     WHERE se.token_hash = $1 AND se.expires_at > now()`,
    [sha256Hex(token)],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function destroySession(app: AppContext, token: string): Promise<void> {
  await app.db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256Hex(token)]);
}

export async function getUserById(app: AppContext, userId: string): Promise<User> {
  const { rows } = await app.db.query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw unauthorized('Account no longer exists');
  return mapUser(rows[0]);
}

export async function getPersonalScopeId(app: AppContext, userId: string): Promise<string> {
  const { rows } = await app.db.query(`SELECT id FROM scopes WHERE type = 'personal' AND user_id = $1`, [userId]);
  if (!rows[0]) {
    // Self-heal for accounts created before personal scopes existed.
    const created = await app.db.query(
      `INSERT INTO scopes (type, name, user_id) VALUES ('personal', 'Personal', $1) RETURNING id`,
      [userId],
    );
    return created.rows[0].id;
  }
  return rows[0].id;
}
