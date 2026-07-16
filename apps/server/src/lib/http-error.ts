import type { ApiError } from '@echo/shared';

export type ErrorCode = ApiError['error']['code'];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  rate_limited: 429,
  signup_disabled: 403,
  email_not_verified: 403,
  verification_invalid: 400,
  password_reset_invalid: 400,
  internal_error: 500,
};

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }

  toBody(): ApiError {
    return { error: { code: this.code, message: this.message } };
  }
}

export const unauthorized = (msg = 'Authentication required') => new HttpError('unauthorized', msg);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError('forbidden', msg);
export const notFound = (msg = 'Not found') => new HttpError('not_found', msg);
export const badRequest = (msg: string) => new HttpError('validation_error', msg);
export const conflict = (msg: string) => new HttpError('conflict', msg);
