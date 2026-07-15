import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { loadConfig } from '@/config';
import { normalizeTags } from '@/core/memories';
import { CONCURRENT_INDEXES, ensureConcurrentIndexes, LEGACY_INDEXES } from '@/db/post-migrations';
import { generateApiKey, hashPassword, sha256Hex, verifyPassword } from '@/lib/crypto';
import { toVectorLiteral } from '@/lib/embeddings';
import { isUniqueViolation } from '@/lib/postgres';
import { escapeLikePattern } from '@/lib/sql';

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
    expect(normalizeTags([' Work ', 'TEAM', 'work', ' ', 'Team', 'personal'])).toEqual([
      'work',
      'team',
      'personal',
    ]);
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
    const config = loadConfig({ APP_URL: 'HTTPS://echo.example' });
    expect(config.secureCookies).toBe(true);
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

    const lastCreate = Math.max(...CONCURRENT_INDEXES.map((index) => calls.findIndex((call) => call.text === index.sql)));
    const firstLegacyDrop = calls.findIndex(
      (call) => call.text.includes('DROP INDEX CONCURRENTLY') && call.text.includes(LEGACY_INDEXES[0]),
    );
    expect(firstLegacyDrop).toBeGreaterThan(lastCreate);
  });
});
