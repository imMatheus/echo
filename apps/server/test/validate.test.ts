import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HttpError } from '@/lib/http-error';
import { parse } from '@/lib/validate';

const schema = z.object({
  name: z.string().min(1),
  age: z.number().int(),
});

describe('parse', () => {
  it('returns the typed data when input is valid', () => {
    expect(parse(schema, { name: 'echo', age: 3 })).toEqual({ name: 'echo', age: 3 });
  });

  it('throws a 400 validation HttpError prefixed with the failing field path', () => {
    try {
      parse(schema, { name: '', age: 3 });
      throw new Error('expected parse to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const httpErr = err as HttpError;
      expect(httpErr.code).toBe('validation_error');
      expect(httpErr.status).toBe(400);
      expect(httpErr.message.startsWith('name: ')).toBe(true);
    }
  });

  it('omits the path prefix for root-level errors', () => {
    const rootSchema = z.string();
    try {
      parse(rootSchema, 123);
      throw new Error('expected parse to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).message).not.toContain(':');
    }
  });
});
