import { z } from 'zod';

/**
 * Reusable Zod primitives shared across the HTTP route validators and the MCP
 * tool definitions. Keeping the field constraints in one place means the API
 * contract stays consistent (and changes in exactly one spot).
 */

/** A UUID identifier used for path params and foreign keys. */
export const uuid = z.string().uuid();

/** `{ id }` route params. */
export const idParam = z.object({ id: uuid });

/** `{ id, userId }` route params for member endpoints. */
export const memberParam = z.object({ id: uuid, userId: uuid });

/** RFC-capped, trimmed email address. */
export const emailAddress = z.string().trim().email().max(254);

/** Account password constraints for signup and password reset. */
export const password = z.string().min(8).max(128);

/** Human-facing display name (organization, scope, API key). */
export const displayName = z.string().trim().min(1).max(100);

/** Short opaque label — source app, tag, or audit action. */
export const shortLabel = z.string().trim().min(1).max(64);

/** Coercible pagination bounds shared by list endpoints. */
export const paginationLimit = z.coerce.number().int().min(1).max(200);
export const paginationOffset = z.coerce.number().int().min(0).max(100_000);

/** Audit-log listing query (limit/offset/action). */
export const auditQuery = z.object({
  limit: paginationLimit.default(50),
  offset: paginationOffset.default(0),
  action: shortLabel.optional(),
});
