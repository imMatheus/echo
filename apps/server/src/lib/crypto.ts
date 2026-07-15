import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  // Stored parameters are data too: bound them before handing them to scrypt so
  // a corrupted row cannot turn one login into an excessive allocation or throw.
  if (
    !Number.isInteger(N) ||
    N < 2 ||
    N > 32_768 ||
    (N & (N - 1)) !== 0 ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > 32 ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(saltB64) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(hashB64)
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (salt.length < 16 || salt.length > 64 || expected.length !== KEY_LEN) return false;
    const derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Random session token; only its sha256 is stored server-side. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** API key: eck_ prefix + 32 random bytes. */
export function generateApiKey(): { secret: string; prefix: string; hash: string } {
  const secret = `eck_${randomBytes(32).toString('base64url')}`;
  return { secret, prefix: secret.slice(0, 12), hash: sha256Hex(secret) };
}
