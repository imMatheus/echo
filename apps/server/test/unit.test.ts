import { describe, expect, it } from 'vitest';
import { generateApiKey, hashPassword, sha256Hex, verifyPassword } from '@/lib/crypto';
import { toVectorLiteral } from '@/lib/embeddings';
import { slugify } from '@/core/orgs';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('hunter2-hunter2');
    expect(await verifyPassword('hunter2-hunter2', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
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

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });
  it('strips diacritics', () => {
    expect(slugify('Café Über')).toBe('cafe-uber');
  });
  it('never returns empty', () => {
    expect(slugify('!!!')).toBe('org');
  });
});

describe('toVectorLiteral', () => {
  it('produces pgvector text form', () => {
    expect(toVectorLiteral([0.1, -2, 3])).toBe('[0.1,-2,3]');
  });
});
