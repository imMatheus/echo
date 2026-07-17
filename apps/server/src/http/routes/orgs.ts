import { ORG_ROLES } from '@echo/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listOrgAudit } from '@/core/audit';
import {
  addOrgMember,
  createOrg,
  deleteOrg,
  getOrg,
  listOrgMembers,
  listOrgs,
  removeOrgMember,
  renameOrg,
  requireOrgRole,
  updateOrgMemberRole,
} from '@/core/orgs';
import { auditQuery, displayName, emailAddress, idParam, memberParam } from '@/lib/schemas';
import { parse } from '@/lib/validate';
import type { AppContext } from '@/types';
import { requireAuth } from '@/http/authn';

const createSchema = z.object({
  name: displayName,
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
      const { name } = parse(z.object({ name: displayName }), req.body);
      return { org: await renameOrg(app, ctx, id, name) };
    });

    f.delete('/orgs/:id', async (req) => {
      const ctx = await requireAuth(app, req);
      const { id } = parse(idParam, req.params);
      await deleteOrg(app, ctx, id);
      return { ok: true };
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
        z.object({
          email: emailAddress,
          role: z.enum(ORG_ROLES).default('member'),
        }),
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
      await requireOrgRole(app, id, ctx.userId, ['owner']);
      const query = parse(auditQuery, req.query);
      return listOrgAudit(app, id, query);
    });
  };
}
