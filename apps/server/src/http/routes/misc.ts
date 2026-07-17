import { STATS_RANGES } from '@echo/shared';
import type { ServerMeta, StatsResponse } from '@echo/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listUserAudit } from '@/core/audit';
import { getUsageStats } from '@/core/stats';
import { VERSION } from '@/config';
import { auditQuery } from '@/lib/schemas';
import { parse } from '@/lib/validate';
import type { AppContext } from '@/types';
import { requireAuth } from '@/http/authn';

const statsQuerySchema = z.object({
  range: z.enum(STATS_RANGES).default('30d'),
});

export function miscRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    f.get('/meta', async (): Promise<ServerMeta> => {
      return {
        name: 'Echo',
        version: VERSION,
        signupEnabled: !app.config.DISABLE_SIGNUP,
        embeddings: app.embeddings ? { provider: app.embeddings.provider, model: app.embeddings.model } : null,
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
      const query = parse(auditQuery, req.query);
      return listUserAudit(app, ctx.userId, query);
    });

    f.get('/stats', async (req): Promise<StatsResponse> => {
      const ctx = await requireAuth(app, req);
      const { range } = parse(statsQuerySchema, req.query);
      return { stats: await getUsageStats(app, ctx.userId, range) };
    });
  };
}
