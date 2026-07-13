import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createApiKey, listApiKeys, revokeApiKey } from '@/core/apikeys';
import { parse } from '@/lib/validate';
import type { AppContext } from '@/types';
import { requireAuth } from '@/http/authn';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  sourceApp: z.string().min(1).max(64).optional(),
});

export function apiKeyRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    f.get('/api-keys', async (req) => {
      const ctx = await requireAuth(app, req);
      return { keys: await listApiKeys(app, ctx.userId) };
    });

    f.post('/api-keys', async (req, reply) => {
      const ctx = await requireAuth(app, req);
      const body = parse(createSchema, req.body);
      reply.code(201);
      return createApiKey(app, ctx, body);
    });

    f.delete('/api-keys/:id', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      await revokeApiKey(app, ctx, id);
      return { ok: true };
    });
  };
}
