import type { Organization, OrganizationWithRole, OrgMember, OrgRole, OrgScopeType, ScopeMember } from '@echo/shared';
import { slugify } from '@echo/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { orgMembers, organizations, scopeMembers, scopes, users } from '@/db/schema';
import { badRequest, conflict, forbidden, notFound } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';
import { logAudit } from './audit';

function mapOrg(row: { id: string; name: string; slug: string; createdAt: Date }): Organization {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.createdAt.toISOString() };
}

/** The caller's role in the org, or null if not a member. */
export async function getOrgRole(app: AppContext, orgId: string, userId: string): Promise<OrgRole | null> {
  const [row] = await app.db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return (row?.role as OrgRole) ?? null;
}

export async function requireOrgRole(
  app: AppContext,
  orgId: string,
  userId: string,
  allowed: OrgRole[],
): Promise<OrgRole> {
  const role = await getOrgRole(app, orgId, userId);
  if (!role) throw notFound('Organization not found');
  if (!allowed.includes(role)) throw forbidden('Your role in this organization does not allow that');
  return role;
}

export async function createOrg(
  app: AppContext,
  ctx: AuthContext,
  input: { name: string; slug?: string },
): Promise<Organization> {
  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  const org = await app.db.transaction(async (tx) => {
    const dupe = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (dupe.length) throw conflict(`Slug "${slug}" is already taken`);
    const [created] = await tx
      .insert(organizations)
      .values({ name: input.name, slug, createdBy: ctx.userId })
      .returning();
    await tx.insert(orgMembers).values({ orgId: created.id, userId: ctx.userId, role: 'owner' });
    await tx.insert(scopes).values({ type: 'organization', name: input.name, orgId: created.id });
    return created;
  });
  await logAudit(app, {
    action: 'org.create',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: org.id,
    details: { name: input.name, slug },
  });
  return mapOrg(org);
}

export async function listOrgs(app: AppContext, userId: string): Promise<OrganizationWithRole[]> {
  const rows = await app.db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      createdAt: organizations.createdAt,
      role: orgMembers.role,
      memberCount: sql<number>`(SELECT count(*)::int FROM org_members m2 WHERE m2.org_id = ${organizations.id})`,
    })
    .from(organizations)
    .innerJoin(orgMembers, and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, userId)))
    .orderBy(organizations.name);
  return rows.map((r) => ({ ...mapOrg(r), role: r.role as OrgRole, memberCount: r.memberCount }));
}

export async function getOrg(app: AppContext, orgId: string, userId: string): Promise<{ org: Organization; role: OrgRole }> {
  const role = await getOrgRole(app, orgId, userId);
  if (!role) throw notFound('Organization not found');
  const [row] = await app.db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!row) throw notFound('Organization not found');
  return { org: mapOrg(row), role };
}

export async function renameOrg(app: AppContext, ctx: AuthContext, orgId: string, name: string): Promise<Organization> {
  await requireOrgRole(app, orgId, ctx.userId, ['owner', 'admin']);
  const [row] = await app.db
    .update(organizations)
    .set({ name })
    .where(eq(organizations.id, orgId))
    .returning();
  if (!row) throw notFound('Organization not found');
  // Keep the org-level scope's display name in sync.
  await app.db
    .update(scopes)
    .set({ name })
    .where(and(eq(scopes.orgId, orgId), eq(scopes.type, 'organization')));
  await logAudit(app, {
    action: 'org.update',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId,
    details: { name },
  });
  return mapOrg(row);
}

function mapMember(row: { userId: string; email: string; name: string; role: string; createdAt: Date }): OrgMember {
  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role as OrgRole,
    joinedAt: row.createdAt.toISOString(),
  };
}

export async function listOrgMembers(app: AppContext, orgId: string, userId: string): Promise<OrgMember[]> {
  const role = await getOrgRole(app, orgId, userId);
  if (!role) throw notFound('Organization not found');
  const rows = await app.db
    .select({
      userId: orgMembers.userId,
      role: orgMembers.role,
      createdAt: orgMembers.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(orgMembers.createdAt);
  return rows.map(mapMember);
}

export async function addOrgMember(
  app: AppContext,
  ctx: AuthContext,
  orgId: string,
  email: string,
  role: OrgRole,
): Promise<OrgMember> {
  const actorRole = await requireOrgRole(app, orgId, ctx.userId, ['owner', 'admin']);
  if (role === 'owner' && actorRole !== 'owner') throw forbidden('Only an owner can add another owner');
  const [user] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw notFound(`No Echo account exists for ${email} — they need to sign up first`);
  const inserted = await app.db
    .insert(orgMembers)
    .values({ orgId, userId: user.id, role })
    .onConflictDoNothing()
    .returning({ createdAt: orgMembers.createdAt });
  if (!inserted.length) throw conflict('That user is already a member of this organization');
  await logAudit(app, {
    action: 'org.member_add',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId,
    details: { memberEmail: email, role },
  });
  return { userId: user.id, email: user.email, name: user.name, role, joinedAt: inserted[0].createdAt.toISOString() };
}

async function countOwners(app: AppContext, orgId: string): Promise<number> {
  const [row] = await app.db
    .select({ n: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));
  return row.n;
}

export async function updateOrgMemberRole(
  app: AppContext,
  ctx: AuthContext,
  orgId: string,
  targetUserId: string,
  newRole: OrgRole,
): Promise<OrgMember> {
  const actorRole = await requireOrgRole(app, orgId, ctx.userId, ['owner', 'admin']);
  const targetRole = await getOrgRole(app, orgId, targetUserId);
  if (!targetRole) throw notFound('That user is not a member of this organization');
  if ((newRole === 'owner' || targetRole === 'owner') && actorRole !== 'owner') {
    throw forbidden('Only an owner can change owner roles');
  }
  if (targetRole === 'owner' && newRole !== 'owner' && (await countOwners(app, orgId)) <= 1) {
    throw badRequest('An organization must keep at least one owner');
  }
  await app.db
    .update(orgMembers)
    .set({ role: newRole })
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)));
  const [row] = await app.db
    .select({
      userId: orgMembers.userId,
      role: orgMembers.role,
      createdAt: orgMembers.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
    .limit(1);
  await logAudit(app, {
    action: 'org.member_update',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId,
    details: { targetUserId, role: newRole },
  });
  return mapMember(row);
}

export async function removeOrgMember(
  app: AppContext,
  ctx: AuthContext,
  orgId: string,
  targetUserId: string,
): Promise<void> {
  const actorRole = await getOrgRole(app, orgId, ctx.userId);
  if (!actorRole) throw notFound('Organization not found');
  const leavingSelf = targetUserId === ctx.userId;
  if (!leavingSelf && actorRole !== 'owner' && actorRole !== 'admin') {
    throw forbidden('Your role in this organization does not allow that');
  }
  const targetRole = await getOrgRole(app, orgId, targetUserId);
  if (!targetRole) throw notFound('That user is not a member of this organization');
  if (targetRole === 'owner' && !leavingSelf && actorRole !== 'owner') {
    throw forbidden('Only an owner can remove another owner');
  }
  if (targetRole === 'owner' && (await countOwners(app, orgId)) <= 1) {
    throw badRequest('An organization must keep at least one owner — transfer ownership first');
  }
  await app.db.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)));
  // Also drop them from every scope inside the org.
  await app.db.delete(scopeMembers).where(
    and(
      eq(scopeMembers.userId, targetUserId),
      inArray(
        scopeMembers.scopeId,
        app.db.select({ id: scopes.id }).from(scopes).where(eq(scopes.orgId, orgId)),
      ),
    ),
  );
  await logAudit(app, {
    action: leavingSelf ? 'org.member_leave' : 'org.member_remove',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId,
    details: { targetUserId },
  });
}

// ---------------------------------------------------------------------------
// Org-owned scopes (workspace / team / project)
// ---------------------------------------------------------------------------

export async function createOrgScope(
  app: AppContext,
  ctx: AuthContext,
  input: { orgId: string; type: OrgScopeType; name: string },
): Promise<{ id: string }> {
  await requireOrgRole(app, input.orgId, ctx.userId, ['owner', 'admin']);
  const [created] = await app.db
    .insert(scopes)
    .values({ type: input.type, name: input.name, orgId: input.orgId })
    .returning({ id: scopes.id });
  const scopeId = created.id;
  await app.db.insert(scopeMembers).values({ scopeId, userId: ctx.userId });
  await logAudit(app, {
    action: 'scope.create',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: input.orgId,
    scopeId,
    details: { type: input.type, name: input.name },
  });
  return { id: scopeId };
}

interface OrgScope {
  id: string;
  type: string;
  name: string;
  orgId: string;
}

async function getOrgScopeOrThrow(app: AppContext, scopeId: string): Promise<OrgScope> {
  const [row] = await app.db
    .select({ id: scopes.id, type: scopes.type, name: scopes.name, orgId: scopes.orgId })
    .from(scopes)
    .where(eq(scopes.id, scopeId))
    .limit(1);
  if (!row || !row.orgId) throw notFound('Scope not found');
  return { id: row.id, type: row.type, name: row.name, orgId: row.orgId };
}

export async function deleteOrgScope(app: AppContext, ctx: AuthContext, scopeId: string): Promise<void> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  if (scope.type === 'organization') throw badRequest('The organization scope cannot be deleted');
  await requireOrgRole(app, scope.orgId, ctx.userId, ['owner', 'admin']);
  await app.db.delete(scopes).where(eq(scopes.id, scopeId)); // memories cascade
  await logAudit(app, {
    action: 'scope.delete',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: scope.orgId,
    scopeId,
    details: { name: scope.name, type: scope.type },
  });
}

export async function listScopeMembers(app: AppContext, ctx: AuthContext, scopeId: string): Promise<ScopeMember[]> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  const role = await getOrgRole(app, scope.orgId, ctx.userId);
  if (!role) throw notFound('Scope not found');
  const rows = await app.db
    .select({
      userId: scopeMembers.userId,
      createdAt: scopeMembers.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(scopeMembers)
    .innerJoin(users, eq(users.id, scopeMembers.userId))
    .where(eq(scopeMembers.scopeId, scopeId))
    .orderBy(scopeMembers.createdAt);
  return rows.map((r) => ({ userId: r.userId, email: r.email, name: r.name, addedAt: r.createdAt.toISOString() }));
}

export async function addScopeMember(app: AppContext, ctx: AuthContext, scopeId: string, email: string): Promise<ScopeMember> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  if (scope.type === 'organization') throw badRequest('Organization scope membership is the org member list');
  await requireOrgRole(app, scope.orgId, ctx.userId, ['owner', 'admin']);
  const [user] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw notFound(`No Echo account exists for ${email}`);
  const memberRole = await getOrgRole(app, scope.orgId, user.id);
  if (!memberRole) throw badRequest('That user must be a member of the organization first');
  const inserted = await app.db
    .insert(scopeMembers)
    .values({ scopeId, userId: user.id })
    .onConflictDoNothing()
    .returning({ createdAt: scopeMembers.createdAt });
  if (!inserted.length) throw conflict('That user is already a member of this scope');
  await logAudit(app, {
    action: 'scope.member_add',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: scope.orgId,
    scopeId,
    details: { memberEmail: email },
  });
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    addedAt: inserted[0].createdAt.toISOString(),
  };
}

export async function removeScopeMember(app: AppContext, ctx: AuthContext, scopeId: string, targetUserId: string): Promise<void> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  await requireOrgRole(app, scope.orgId, ctx.userId, ['owner', 'admin']);
  const removed = await app.db
    .delete(scopeMembers)
    .where(and(eq(scopeMembers.scopeId, scopeId), eq(scopeMembers.userId, targetUserId)))
    .returning({ userId: scopeMembers.userId });
  if (!removed.length) throw notFound('That user is not a member of this scope');
  await logAudit(app, {
    action: 'scope.member_remove',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: scope.orgId,
    scopeId,
    details: { targetUserId },
  });
}
