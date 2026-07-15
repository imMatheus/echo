import type { Organization, OrganizationWithRole, OrgMember, OrgRole, OrgScopeType, ScopeMember } from '@echo/shared';
import { and, eq, sql } from 'drizzle-orm';
import { orgMembers, organizations, scopeMembers, scopes, users } from '@/db/schema';
import { badRequest, conflict, forbidden, notFound } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';
import { getScopeAccess } from './access';
import { logAudit } from './audit';

function mapOrg(row: { id: string; name: string; createdAt: Date }): Organization {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
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
  input: { name: string },
): Promise<Organization> {
  const org = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(organizations).values({ name: input.name, createdBy: ctx.userId }).returning();
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
    details: { name: input.name },
  });
  return mapOrg(org);
}

export async function listOrgs(app: AppContext, userId: string): Promise<OrganizationWithRole[]> {
  const rows = await app.db
    .select({
      id: organizations.id,
      name: organizations.name,
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
  const row = await app.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`);
    const [membership] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1);
    if (!membership) throw notFound('Organization not found');
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      throw forbidden('Your role in this organization does not allow that');
    }
    const [updated] = await tx
      .update(organizations)
      .set({ name })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!updated) throw notFound('Organization not found');
    // Keep the org-level scope's display name in sync atomically.
    await tx
      .update(scopes)
      .set({ name })
      .where(and(eq(scopes.orgId, orgId), eq(scopes.type, 'organization')));
    return updated;
  });
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
  const result = await app.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`);
    if (!locked.rows.length) throw notFound('Organization not found');
    const [actor] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1);
    if (!actor) throw notFound('Organization not found');
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw forbidden('Your role in this organization does not allow that');
    }
    if (role === 'owner' && actor.role !== 'owner') throw forbidden('Only an owner can add another owner');
    const [user] = await tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user) throw notFound(`No Echo account exists for ${email} — they need to sign up first`);
    const inserted = await tx
      .insert(orgMembers)
      .values({ orgId, userId: user.id, role })
      .onConflictDoNothing()
      .returning({ createdAt: orgMembers.createdAt });
    if (!inserted.length) throw conflict('That user is already a member of this organization');
    return { user, createdAt: inserted[0].createdAt };
  });
  await logAudit(app, {
    action: 'org.member_add',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId,
    details: { memberEmail: email, role },
  });
  return {
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    role,
    joinedAt: result.createdAt.toISOString(),
  };
}

export async function updateOrgMemberRole(
  app: AppContext,
  ctx: AuthContext,
  orgId: string,
  targetUserId: string,
  newRole: OrgRole,
): Promise<OrgMember> {
  const row = await app.db.transaction(async (tx) => {
    // Every owner-role mutation locks the organization row first. Concurrent
    // demotions/removals across processes therefore cannot both observe two
    // owners and leave the organization ownerless.
    const locked = await tx.execute(sql`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`);
    if (!locked.rows.length) throw notFound('Organization not found');
    const [actor, target] = await Promise.all([
      tx
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, ctx.userId)))
        .limit(1),
      tx
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
        .limit(1),
    ]);
    const actorRole = actor[0]?.role as OrgRole | undefined;
    const targetRole = target[0]?.role as OrgRole | undefined;
    if (!actorRole) throw notFound('Organization not found');
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      throw forbidden('Your role in this organization does not allow that');
    }
    if (!targetRole) throw notFound('That user is not a member of this organization');
    if ((newRole === 'owner' || targetRole === 'owner') && actorRole !== 'owner') {
      throw forbidden('Only an owner can change owner roles');
    }
    if (targetRole === 'owner' && newRole !== 'owner') {
      const [owners] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));
      if (owners.n <= 1) throw badRequest('An organization must keep at least one owner');
    }
    const [updated] = await tx
      .update(orgMembers)
      .set({ role: newRole })
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
      .returning({ userId: orgMembers.userId });
    if (!updated) throw notFound('That user is not a member of this organization');
    const [member] = await tx
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
    if (!member) throw notFound('That user is not a member of this organization');
    return member;
  });
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
  const leavingSelf = targetUserId === ctx.userId;
  await app.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`);
    if (!locked.rows.length) throw notFound('Organization not found');
    const [actor, target] = await Promise.all([
      tx
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, ctx.userId)))
        .limit(1),
      tx
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
        .limit(1),
    ]);
    const actorRole = actor[0]?.role as OrgRole | undefined;
    const targetRole = target[0]?.role as OrgRole | undefined;
    if (!actorRole) throw notFound('Organization not found');
    if (!leavingSelf && actorRole !== 'owner' && actorRole !== 'admin') {
      throw forbidden('Your role in this organization does not allow that');
    }
    if (!targetRole) throw notFound('That user is not a member of this organization');
    if (targetRole === 'owner' && !leavingSelf && actorRole !== 'owner') {
      throw forbidden('Only an owner can remove another owner');
    }
    if (targetRole === 'owner') {
      const [owners] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));
      if (owners.n <= 1) {
        throw badRequest('An organization must keep at least one owner — transfer ownership first');
      }
    }
    const removed = await tx
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
      .returning({ userId: orgMembers.userId });
    if (!removed.length) throw notFound('That user is not a member of this organization');
    // The composite scope-membership FK cascades every org-scoped membership.
  });
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
  const scopeId = await app.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT id FROM organizations WHERE id = ${input.orgId} FOR UPDATE`);
    if (!locked.rows.length) throw notFound('Organization not found');
    const [actor] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1);
    if (!actor) throw notFound('Organization not found');
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw forbidden('Your role in this organization does not allow that');
    }
    const [created] = await tx
      .insert(scopes)
      .values({ type: input.type, name: input.name, orgId: input.orgId })
      .returning({ id: scopes.id });
    await tx.insert(scopeMembers).values({ scopeId: created.id, userId: ctx.userId, orgId: input.orgId });
    return created.id;
  });
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

interface OrgScope extends Record<string, unknown> {
  id: string;
  type: string;
  name: string;
  orgId: string;
}

const lockOrgScopeQuery = (scopeId: string, orgId: string) => sql`
  SELECT id, type, name, org_id AS "orgId"
  FROM scopes
  WHERE id = ${scopeId} AND org_id = ${orgId}
  FOR UPDATE`;

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
  const deletedScope = await app.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM organizations WHERE id = ${scope.orgId} FOR UPDATE`);
    const locked = await tx.execute<OrgScope>(lockOrgScopeQuery(scopeId, scope.orgId));
    const currentScope = locked.rows[0];
    if (!currentScope) throw notFound('Scope not found');
    const [actor] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, scope.orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1);
    if (!actor) throw notFound('Scope not found');
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw forbidden('Your role in this organization does not allow that');
    }
    // Check the special type only after authorization to avoid a cross-org
    // existence/type oracle for callers who happen to know a scope UUID.
    if (currentScope.type === 'organization') throw badRequest('The organization scope cannot be deleted');
    const deleted = await tx.delete(scopes).where(eq(scopes.id, scopeId)).returning({ id: scopes.id });
    if (!deleted.length) throw notFound('Scope not found');
    return currentScope;
  }); // memories cascade
  await logAudit(app, {
    action: 'scope.delete',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: deletedScope.orgId,
    scopeId,
    details: { name: deletedScope.name, type: deletedScope.type },
  });
}

export async function listScopeMembers(app: AppContext, ctx: AuthContext, scopeId: string): Promise<ScopeMember[]> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  const access = await getScopeAccess(app, ctx.userId, scopeId, false);
  if (!access) throw notFound('Scope not found');
  if (scope.type === 'organization') {
    const rows = await app.db
      .select({
        userId: orgMembers.userId,
        createdAt: orgMembers.createdAt,
        email: users.email,
        name: users.name,
      })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(eq(orgMembers.orgId, scope.orgId))
      .orderBy(orgMembers.createdAt);
    return rows.map((r) => ({ userId: r.userId, email: r.email, name: r.name, addedAt: r.createdAt.toISOString() }));
  }
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
  const result = await app.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM organizations WHERE id = ${scope.orgId} FOR UPDATE`);
    const locked = await tx.execute<OrgScope>(lockOrgScopeQuery(scopeId, scope.orgId));
    const currentScope = locked.rows[0];
    if (!currentScope) throw notFound('Scope not found');
    const [actor] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, scope.orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1);
    if (!actor) throw notFound('Scope not found');
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw forbidden('Your role in this organization does not allow that');
    }
    if (currentScope.type === 'organization') {
      throw badRequest('Organization scope membership is the org member list');
    }
    const [user] = await tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user) throw notFound(`No Echo account exists for ${email}`);
    const [membership] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, scope.orgId), eq(orgMembers.userId, user.id)))
      .limit(1);
    if (!membership) throw badRequest('That user must be a member of the organization first');
    const inserted = await tx
      .insert(scopeMembers)
      .values({ scopeId, userId: user.id, orgId: currentScope.orgId })
      .onConflictDoNothing()
      .returning({ createdAt: scopeMembers.createdAt });
    if (!inserted.length) throw conflict('That user is already a member of this scope');
    return { user, createdAt: inserted[0].createdAt };
  });
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
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    addedAt: result.createdAt.toISOString(),
  };
}

export async function removeScopeMember(app: AppContext, ctx: AuthContext, scopeId: string, targetUserId: string): Promise<void> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  await app.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM organizations WHERE id = ${scope.orgId} FOR UPDATE`);
    const locked = await tx.execute<OrgScope>(lockOrgScopeQuery(scopeId, scope.orgId));
    const currentScope = locked.rows[0];
    if (!currentScope) throw notFound('Scope not found');
    const [actor] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, scope.orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1);
    if (!actor) throw notFound('Scope not found');
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw forbidden('Your role in this organization does not allow that');
    }
    if (currentScope.type === 'organization') {
      throw badRequest('Organization scope membership is the org member list');
    }
    const removed = await tx
      .delete(scopeMembers)
      .where(and(eq(scopeMembers.scopeId, scopeId), eq(scopeMembers.userId, targetUserId)))
      .returning({ userId: scopeMembers.userId });
    if (!removed.length) throw notFound('That user is not a member of this scope');
  });
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
