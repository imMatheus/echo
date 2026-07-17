import { MEMORY_KINDS, SENSITIVITIES } from '@echo/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createMemory, deleteMemory, getMemory, listMemories, searchMemories, updateMemory } from '@/core/memories';
import { idParam, paginationLimit, paginationOffset, shortLabel, uuid } from '@/lib/schemas';
import { parse } from '@/lib/validate';
import type { AppContext } from '@/types';
import { requireAuth } from '@/http/authn';

const listQuerySchema = z.object({
  scopeId: uuid.optional(),
  q: z.string().trim().min(1).max(500).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  sensitivity: z.enum(SENSITIVITIES).optional(),
  sourceApp: shortLabel.optional(),
  tag: shortLabel.optional(),
  limit: paginationLimit.optional(),
  offset: paginationOffset.optional(),
});

const futureDateTime = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) > Date.now(), 'must be in the future');

const tagSchema = shortLabel;

const createSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  scopeId: uuid.optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sensitivity: z.enum(SENSITIVITIES).optional(),
  tags: z.array(tagSchema).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: futureDateTime.nullish(),
  sourceApp: shortLabel.optional(),
});

const updateSchema = z.object({
  content: z.string().trim().min(1).max(10_000).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sensitivity: z.enum(SENSITIVITIES).optional(),
  tags: z.array(tagSchema).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: futureDateTime.nullable().optional(),
  scopeId: uuid.optional(),
});

const searchSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  scopeIds: z.array(uuid).max(100).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export function memoryRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    f.get('/memories', async (req) => {
      const ctx = await requireAuth(app, req);
      const query = parse(listQuerySchema, req.query);
      return listMemories(app, ctx, query);
    });

    f.post('/memories', async (req, reply) => {
      const ctx = await requireAuth(app, req);
      const body = parse(createSchema, req.body);
      const memory = await createMemory(app, ctx, body);
      reply.code(201);
      return { memory };
    });

    f.post('/memories/search', async (req) => {
      const ctx = await requireAuth(app, req);
      const body = parse(searchSchema, req.body);
      return searchMemories(app, ctx, body);
    });

    f.get('/memories/:id', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      return { memory: await getMemory(app, ctx, id) };
    });

    f.patch('/memories/:id', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      const body = parse(updateSchema, req.body);
      return { memory: await updateMemory(app, ctx, id, body) };
    });

    f.delete('/memories/:id', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      await deleteMemory(app, ctx, id);
      return { ok: true };
    });
  };
}
