import type { ServerMeta } from '@echo/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listUserAudit } from '@/core/audit';
import { VERSION } from '@/config';
import { parse } from '@/lib/validate';
import type { AppContext } from '@/types';
import { requireAuth } from '@/http/authn';

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().max(64).optional(),
});

export function miscRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    f.get('/meta', async (): Promise<ServerMeta> => {
      return {
        name: 'Echo',
        version: VERSION,
        signupEnabled: !app.config.DISABLE_SIGNUP,
        embeddings: app.embeddings
          ? { provider: app.embeddings.provider, model: app.embeddings.model }
          : null,
      };
    });

    f.get('/health', async (req, reply) => {
      try {
        await app.db.execute(sql`SELECT 1`);
        return { ok: true, db: true };
      } catch {
        reply.code(503);
        return { ok: false, db: false };
      }
    });

    f.get('/audit', async (req) => {
      const ctx = await requireAuth(app, req);
      const query = parse(auditQuerySchema, req.query);
      return listUserAudit(app, ctx.userId, query);
    });
  };
}
