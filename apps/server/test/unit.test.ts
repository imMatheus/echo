import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { loadConfig } from '@/config';
import { ConsoleEmailProvider } from '@/email/provider';
import { buildApp } from '@/http/app';
import { normalizeTags } from '@/core/memories';
import { CONCURRENT_INDEXES, ensureConcurrentIndexes, LEGACY_INDEXES } from '@/db/post-migrations';
import { normalizeDatabaseUrl } from '@/db';
import {
  createAuthActionToken,
  generateApiKey,
  hashPassword,
  sha256Hex,
  verifyAuthActionToken,
  verifyPassword,
} from '@/lib/crypto';
import { ResendEmailProvider } from '@/email/provider';
import { renderAuthEmail } from '@/email/templates';
import { toVectorLiteral } from '@/lib/embeddings';
import { isUniqueViolation } from '@/lib/postgres';
import { escapeLikePattern } from '@/lib/sql';
import type { AppContext } from '@/types';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('hunter2-hunter2');
    expect(await verifyPassword('hunter2-hunter2', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('rejects well-shaped hashes with unsafe work factors', async () => {
    const salt = Buffer.alloc(16).toString('base64');
    const hash = Buffer.alloc(64).toString('base64');
    expect(await verifyPassword('anything', `scrypt$1048576$8$1$${salt}$${hash}`)).toBe(false);
  });
});

describe('api keys', () => {
  it('generates eck_-prefixed keys whose hash matches sha256', () => {
    const { secret, prefix, hash } = generateApiKey();
    expect(secret.startsWith('eck_')).toBe(true);
    expect(prefix).toBe(secret.slice(0, 12));
    expect(hash).toBe(sha256Hex(secret));
  });

  it('generates unique keys', () => {
    expect(generateApiKey().secret).not.toBe(generateApiKey().secret);
  });
});

describe('email authentication tokens', () => {
  it('creates opaque, purpose-bound tokens and stores only their hash', () => {
    const secret = 'test-auth-token-secret-that-is-at-least-thirty-two-characters';
    const userId = '00000000-0000-4000-8000-000000000001';
    const generated = createAuthActionToken(secret, 'verify_email', userId);
    expect(generated.token).not.toContain(secret);
    expect(generated.tokenHash).toBe(sha256Hex(generated.token));
    expect(
      verifyAuthActionToken(
        generated.token,
        { id: generated.id, userId, purpose: 'verify_email', tokenHash: generated.tokenHash },
        secret,
      ),
    ).toBe(true);
    expect(
      verifyAuthActionToken(
        generated.token,
        { id: generated.id, userId, purpose: 'password_reset', tokenHash: generated.tokenHash },
        secret,
      ),
    ).toBe(false);
  });
});

describe('email providers and templates', () => {
  it('sends Resend API requests with provider idempotency', async () => {
    const requests: Request[] = [];
    const provider = new ResendEmailProvider({ RESEND_API_KEY: 're_test' }, (async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ id: 'email_123' });
    }) as typeof fetch);
    const result = await provider.send({
      to: 'user@example.com',
      from: 'Echo <auth@example.com>',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
      idempotencyKey: 'outbox-1',
    });
    expect(result.messageId).toBe('email_123');
    expect(requests[0]?.headers.get('idempotency-key')).toBe('outbox-1');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer re_test');
  });

  it('escapes names and puts reset tokens only in the action URL', () => {
    const email = renderAuthEmail({
      template: 'password_reset',
      name: '<script>alert(1)</script>',
      email: 'user@example.com',
      token: 'token-value',
      appUrl: 'https://echo.example',
      from: 'Echo <auth@example.com>',
      idempotencyKey: 'outbox-2',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('https://echo.example/reset-password?token=token-value');
    expect(email.subject).not.toContain('token-value');
  });
});

describe('toVectorLiteral', () => {
  it('produces pgvector text form', () => {
    expect(toVectorLiteral([0.1, -2, 3])).toBe('[0.1,-2,3]');
  });

  it('rejects empty and non-finite provider responses', () => {
    expect(() => toVectorLiteral([])).toThrow('invalid vector');
    expect(() => toVectorLiteral([0.1, Number.NaN])).toThrow('invalid vector');
  });
});

describe('tag normalization', () => {
  it('trims, lowercases, removes blanks, and preserves first occurrence order', () => {
    expect(normalizeTags([' Work ', 'TEAM', 'work', ' ', 'Team', 'personal'])).toEqual(['work', 'team', 'personal']);
  });
});

describe('literal ILIKE escaping', () => {
  it('escapes every PostgreSQL pattern metacharacter', () => {
    expect(escapeLikePattern(String.raw`50%_off\today`)).toBe(String.raw`50\%\_off\\today`);
  });
});

describe('Postgres errors', () => {
  it('recognizes direct and wrapped unique-constraint violations', () => {
    const error = { code: '23505', constraint: 'users_email_unique' };
    expect(isUniqueViolation(error, 'users_email_unique')).toBe(true);
    expect(isUniqueViolation({ cause: error }, 'users_email_unique')).toBe(true);
    expect(isUniqueViolation(error, 'organizations_slug_unique')).toBe(false);
  });
});

describe('configuration', () => {
  it('detects secure cookies from a case-insensitive HTTPS scheme', () => {
    const config = loadConfig({
      APP_URL: 'HTTPS://echo.example',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test',
      AUTH_TOKEN_SECRET: 'production-test-token-secret-with-at-least-thirty-two-characters',
    });
    expect(config.secureCookies).toBe(true);
  });

  it('rejects development email credentials for an HTTPS deployment', () => {
    expect(() => loadConfig({ APP_URL: 'https://echo.example' })).toThrow('unique AUTH_TOKEN_SECRET');
    expect(() =>
      loadConfig({
        APP_URL: 'https://echo.example',
        AUTH_TOKEN_SECRET: 'production-test-token-secret-with-at-least-thirty-two-characters',
      }),
    ).toThrow('production EMAIL_PROVIDER');
  });

  it('requires a real sender, public URL, and unique secret for Resend', () => {
    const productionSecret = 'production-test-token-secret-with-at-least-thirty-two-characters';
    expect(() => loadConfig({ EMAIL_FROM: 'Echo <mail.example.com>' })).toThrow('Invalid environment configuration');
    expect(() => loadConfig({ EMAIL_REPLY_TO: 'support.example.com' })).toThrow('Invalid environment configuration');
    expect(() => loadConfig({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' })).toThrow('requires APP_URL');
    expect(() =>
      loadConfig({
        APP_URL: 'http://localhost:5173',
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test',
      }),
    ).toThrow('requires a unique AUTH_TOKEN_SECRET');
    expect(
      loadConfig({
        APP_URL: 'http://localhost:5173',
        EMAIL_PROVIDER: 'resend',
        EMAIL_FROM: 'Echo <auth@mail.example.com>',
        EMAIL_REPLY_TO: 'support@mail.example.com',
        RESEND_API_KEY: 're_test',
        AUTH_TOKEN_SECRET: productionSecret,
      }).EMAIL_FROM,
    ).toBe('Echo <auth@mail.example.com>');
  });

  it('rejects out-of-range ports, fractional session TTLs, and unknown log levels', () => {
    expect(() => loadConfig({ PORT: '65536' })).toThrow('Invalid environment configuration');
    expect(() => loadConfig({ SESSION_TTL_DAYS: '1.5' })).toThrow('Invalid environment configuration');
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow('Invalid environment configuration');
  });

  it('treats Docker Compose empty passthrough values as unset', () => {
    const config = loadConfig({
      APP_URL: '',
      EMBEDDINGS_MODEL: '',
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: '',
      OLLAMA_URL: '',
      STATIC_DIR: '',
      VOYAGE_API_KEY: '',
    });
    expect(config.APP_URL).toBeUndefined();
    expect(config.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(config.OLLAMA_URL).toBe('http://localhost:11434');
  });

  it('passes a configured external database URL through unchanged', () => {
    const databaseUrl =
      'postgresql://app.branch:pscale_pw_secret@demo-useast1-1.horizon.psdb.cloud:5432/echo?sslmode=require';
    expect(loadConfig({ DATABASE_URL: databaseUrl }).DATABASE_URL).toBe(databaseUrl);
  });

  it('uses the local Docker database when DATABASE_URL is unset', () => {
    expect(loadConfig({ DATABASE_URL: '' }).DATABASE_URL).toBe('postgres://echo:echo@localhost:5433/echo');
  });
});

describe('database URL normalization', () => {
  it('drops the libpq sslrootcert=system keyword pg cannot parse, keeping TLS on', () => {
    const normalized = normalizeDatabaseUrl(
      'postgresql://app.branch:pscale_pw@gcp-us-east1-1.pg.psdb.cloud:5432/postgres?sslmode=verify-full&sslrootcert=system',
    );
    const url = new URL(normalized);
    expect(url.searchParams.has('sslrootcert')).toBe(false);
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
  });

  it('forces sslmode on when only sslrootcert=system requested TLS', () => {
    const url = new URL(normalizeDatabaseUrl('postgres://u:p@host:5432/db?sslrootcert=system'));
    expect(url.searchParams.has('sslrootcert')).toBe(false);
    expect(url.searchParams.get('sslmode')).toBe('require');
  });

  it('leaves the local Docker URL and real CA file paths untouched', () => {
    expect(normalizeDatabaseUrl('postgres://echo:echo@localhost:5433/echo')).toBe(
      'postgres://echo:echo@localhost:5433/echo',
    );
    const withFile = 'postgres://u:p@host:5432/db?sslrootcert=/etc/ssl/ca.pem';
    expect(normalizeDatabaseUrl(withFile)).toBe(withFile);
  });

  it('configures the local Vite origin and rejects insecure cross-site cookies', () => {
    expect(loadConfig({}).WEB_ORIGIN).toBe('http://localhost:5173');
    expect(() => loadConfig({ COOKIE_SAME_SITE: 'none' })).toThrow('requires an HTTPS APP_URL');
    expect(
      loadConfig({
        APP_URL: 'https://app.example.com',
        WEB_ORIGIN: 'https://app.example.com/',
        COOKIE_SAME_SITE: 'none',
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test',
        AUTH_TOKEN_SECRET: 'production-test-token-secret-with-at-least-thirty-two-characters',
      }).WEB_ORIGIN,
    ).toBe('https://app.example.com');
  });
});

describe('cross-origin dashboard access', () => {
  it('allows only the configured browser origin and supports credentialed preflight', async () => {
    const app = await buildApp({
      config: loadConfig({ WEB_ORIGIN: 'https://app.example.com' }),
      db: {} as AppContext['db'],
      embeddings: null,
      email: new ConsoleEmailProvider(),
      log: console,
    });
    try {
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/login',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'POST',
        },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(preflight.headers['access-control-allow-credentials']).toBe('true');

      const rejected = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { origin: 'https://attacker.example' },
      });
      expect(rejected.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe('post-migration index maintenance', () => {
  it('keeps concurrent index DDL out of the transactional Drizzle migration', () => {
    const migration = readFileSync(new URL('../drizzle/0001_lucky_earthquake.sql', import.meta.url), 'utf8');
    const executable = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/\b(?:CREATE|DROP)\s+INDEX\b/i);
  });

  it('recovers invalid builds and creates every replacement before dropping legacy indexes', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const invalidIndex = CONCURRENT_INDEXES[0].name;
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        if (text.includes('pg_catalog.pg_index')) {
          return { rows: values?.[0] === invalidIndex ? [{ isValid: false }] : [] };
        }
        return { rows: [] };
      },
    } as unknown as PoolClient;

    await ensureConcurrentIndexes(client);

    for (const index of CONCURRENT_INDEXES) {
      expect(index.sql).toMatch(/^CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
      expect(calls.some((call) => call.text === index.sql)).toBe(true);
    }
    const invalidDrop = calls.findIndex(
      (call) => call.text.includes('DROP INDEX CONCURRENTLY') && call.text.includes(invalidIndex),
    );
    const recoveredCreate = calls.findIndex((call) => call.text === CONCURRENT_INDEXES[0].sql);
    expect(invalidDrop).toBeGreaterThanOrEqual(0);
    expect(invalidDrop).toBeLessThan(recoveredCreate);

    const lastCreate = Math.max(
      ...CONCURRENT_INDEXES.map((index) => calls.findIndex((call) => call.text === index.sql)),
    );
    const firstLegacyDrop = calls.findIndex(
      (call) => call.text.includes('DROP INDEX CONCURRENTLY') && call.text.includes(LEGACY_INDEXES[0]),
    );
    expect(firstLegacyDrop).toBeGreaterThan(lastCreate);
  });
});
