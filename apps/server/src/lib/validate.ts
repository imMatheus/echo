import type { z } from 'zod';
import { badRequest } from './http-error';

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${path}${issue.message}`);
  }
  return result.data;
}
