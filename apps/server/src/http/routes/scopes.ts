import { ORG_SCOPE_TYPES } from '@echo/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAccessibleScopes, getScopeAccess, toScopeWithAccess } from '@/core/access';
import {
  addScopeMember,
  createOrgScope,
  deleteOrgScope,
  listScopeMembers,
  removeScopeMember,
} from '@/core/orgs';
import { notFound } from '@/lib/http-error';
import { parse } from '@/lib/validate';
import type { AppContext } from '@/types';
import { requireAuth } from '@/http/authn';

const createSchema = z.object({
  orgId: z.string().uuid(),
  type: z.enum(ORG_SCOPE_TYPES),
  name: z.string().min(1).max(100),
});

const idParam = z.object({ id: z.string().uuid() });
const memberParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

export function scopeRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    f.get('/scopes', async (req) => {
      const ctx = await requireAuth(app, req);
      const scopes = await getAccessibleScopes(app, ctx.userId);
      return { scopes: scopes.map(toScopeWithAccess) };
    });

    f.post('/scopes', async (req, reply) => {
      const ctx = await requireAuth(app, req);
      const body = parse(createSchema, req.body);
      const { id } = await createOrgScope(app, ctx, body);
      const scope = await getScopeAccess(app, ctx.userId, id);
      if (!scope) throw notFound('Scope not found');
      reply.code(201);
      return { scope: toScopeWithAccess(scope) };
    });

    f.delete('/scopes/:id', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      await deleteOrgScope(app, ctx, id);
      return { ok: true };
    });

    f.get('/scopes/:id/members', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      return { members: await listScopeMembers(app, ctx, id) };
    });

    f.post('/scopes/:id/members', async (req, reply) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      const { email } = parse(z.object({ email: z.string().email() }), req.body);
      const member = await addScopeMember(app, ctx, id, email);
      reply.code(201);
      return { member };
    });

    f.delete('/scopes/:id/members/:userId', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id, userId } = parse(memberParam, req.params);
      await removeScopeMember(app, ctx, id, userId);
      return { ok: true };
    });
  };
}
