import { describe, expect, it } from 'vitest';
import { badRequest, conflict, type ErrorCode, forbidden, HttpError, notFound, unauthorized } from '@/lib/http-error';

describe('HttpError', () => {
  it('maps every error code to its HTTP status', () => {
    const cases: Array<[ErrorCode, number]> = [
      ['unauthorized', 401],
      ['forbidden', 403],
      ['not_found', 404],
      ['validation_error', 400],
      ['conflict', 409],
      ['rate_limited', 429],
      ['signup_disabled', 403],
      ['email_not_verified', 403],
      ['verification_invalid', 400],
      ['password_reset_invalid', 400],
      ['internal_error', 500],
    ];
    for (const [code, status] of cases) {
      expect(new HttpError(code, 'x').status).toBe(status);
    }
  });

  it('serializes to the API error envelope', () => {
    expect(new HttpError('conflict', 'already exists').toBody()).toEqual({
      error: { code: 'conflict', message: 'already exists' },
    });
  });

  it('is a real Error carrying its message', () => {
    const err = new HttpError('not_found', 'gone');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('gone');
  });
});

describe('error constructors', () => {
  it('build errors with the right code, status, and default messages', () => {
    const u = unauthorized();
    expect([u.code, u.status, u.message]).toEqual(['unauthorized', 401, 'Authentication required']);

    const f = forbidden();
    expect([f.code, f.status, f.message]).toEqual(['forbidden', 403, 'You do not have access to this resource']);

    const n = notFound();
    expect([n.code, n.status, n.message]).toEqual(['not_found', 404, 'Not found']);
  });

  it('accept custom messages', () => {
    expect(unauthorized('nope').message).toBe('nope');
    expect(forbidden('denied').message).toBe('denied');
    expect(notFound('missing').message).toBe('missing');
    expect(badRequest('bad input').code).toBe('validation_error');
    expect(badRequest('bad input').status).toBe(400);
    expect(conflict('dup').code).toBe('conflict');
    expect(conflict('dup').status).toBe(409);
  });
});
