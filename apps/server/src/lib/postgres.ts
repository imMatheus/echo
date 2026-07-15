interface PgErrorShape {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** Recognize node-postgres unique violations without coupling core code to its error class. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const pgError = current as PgErrorShape;
    if (pgError.code === '23505' && (!constraint || pgError.constraint === constraint)) return true;
    current = pgError.cause;
  }
  return false;
}
