import { ORG_ROLES } from '@echo/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listOrgAudit } from '../../core/audit.js';
import {
  addOrgMember,
  createOrg,
  getOrg,
  listOrgMembers,
  listOrgs,
  removeOrgMember,
  renameOrg,
  requireOrgRole,
  updateOrgMemberRole,
} from '../../core/orgs.js';
import { parse } from '../../lib/validate.js';
import type { AppContext } from '../../types.js';
import { requireAuth } from '../authn.js';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only')
    .optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const memberParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().max(64).optional(),
});

export function orgRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    f.get('/orgs', async (req) => {
      const ctx = await requireAuth(app, req);
      return { orgs: await listOrgs(app, ctx.userId) };
    });

    f.post('/orgs', async (req, reply) => {
      const ctx = await requireAuth(app, req);
      const body = parse(createSchema, req.body);
      const org = await createOrg(app, ctx, body);
      reply.code(201);
      return { org };
    });

    f.get('/orgs/:id', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      return getOrg(app, id, ctx.userId);
    });

    f.patch('/orgs/:id', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      const { name } = parse(z.object({ name: z.string().min(1).max(100) }), req.body);
      return { org: await renameOrg(app, ctx, id, name) };
    });

    f.get('/orgs/:id/members', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      return { members: await listOrgMembers(app, id, ctx.userId) };
    });

    f.post('/orgs/:id/members', async (req, reply) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      const body = parse(
        z.object({ email: z.string().email(), role: z.enum(ORG_ROLES).default('member') }),
        req.body,
      );
      const member = await addOrgMember(app, ctx, id, body.email, body.role);
      reply.code(201);
      return { member };
    });

    f.patch('/orgs/:id/members/:userId', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id, userId } = parse(memberParam, req.params);
      const { role } = parse(z.object({ role: z.enum(ORG_ROLES) }), req.body);
      return { member: await updateOrgMemberRole(app, ctx, id, userId, role) };
    });

    f.delete('/orgs/:id/members/:userId', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id, userId } = parse(memberParam, req.params);
      await removeOrgMember(app, ctx, id, userId);
      return { ok: true };
    });

    f.get('/orgs/:id/audit', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      await requireOrgRole(app, id, ctx.userId, ['owner', 'admin']);
      const query = parse(auditQuerySchema, req.query);
      return listOrgAudit(app, id, query);
    });
  };
}
