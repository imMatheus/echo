import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createApiKey, listApiKeys, revokeApiKey } from '@/core/apikeys';
import { displayName, idParam, shortLabel } from '@/lib/schemas';
import { parse } from '@/lib/validate';
import type { AppContext } from '@/types';
import { requireSessionAuth } from '@/http/authn';

const createSchema = z.object({
  name: displayName,
  sourceApp: shortLabel.optional(),
});

export function apiKeyRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    f.get('/api-keys', async (req) => {
      const ctx = await requireSessionAuth(app, req);
      return { keys: await listApiKeys(app, ctx.userId) };
    });

    f.post('/api-keys', async (req, reply) => {
      const ctx = await requireSessionAuth(app, req);
      const body = parse(createSchema, req.body);
      reply.code(201);
      return createApiKey(app, ctx, body);
    });

    f.delete('/api-keys/:id', async (req) => {
      const ctx = await requireSessionAuth(app, req);
      const { id } = parse(idParam, req.params);
      await revokeApiKey(app, ctx, id);
      return { ok: true };
    });
  };
}
