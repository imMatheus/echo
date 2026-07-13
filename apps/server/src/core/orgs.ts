import type { Organization, OrganizationWithRole, OrgMember, OrgRole, OrgScopeType, ScopeMember } from '@echo/shared';
import { slugify } from '@echo/shared';
import { badRequest, conflict, forbidden, notFound } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';
import { logAudit } from './audit';

function mapOrg(row: any): Organization {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at.toISOString() };
}

/** The caller's role in the org, or null if not a member. */
export async function getOrgRole(app: AppContext, orgId: string, userId: string): Promise<OrgRole | null> {
  const { rows } = await app.db.query('SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2', [
    orgId,
    userId,
  ]);
  return rows[0]?.role ?? null;
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
  const client = await app.db.connect();
  try {
    await client.query('BEGIN');
    const dupe = await client.query('SELECT 1 FROM organizations WHERE slug = $1', [slug]);
    if (dupe.rowCount) throw conflict(`Slug "${slug}" is already taken`);
    const { rows } = await client.query(
      'INSERT INTO organizations (name, slug, created_by) VALUES ($1, $2, $3) RETURNING *',
      [input.name, slug, ctx.userId],
    );
    const org = rows[0];
    await client.query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      org.id,
      ctx.userId,
    ]);
    await client.query(`INSERT INTO scopes (type, name, org_id) VALUES ('organization', $1, $2)`, [
      input.name,
      org.id,
    ]);
    await client.query('COMMIT');
    await logAudit(app, {
      action: 'org.create',
      actorUserId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
      sourceApp: ctx.sourceApp,
      orgId: org.id,
      details: { name: input.name, slug },
    });
    return mapOrg(org);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listOrgs(app: AppContext, userId: string): Promise<OrganizationWithRole[]> {
  const { rows } = await app.db.query(
    `SELECT o.*, om.role,
            (SELECT count(*)::int FROM org_members m2 WHERE m2.org_id = o.id) AS member_count
     FROM organizations o
     JOIN org_members om ON om.org_id = o.id AND om.user_id = $1
     ORDER BY o.name`,
    [userId],
  );
  return rows.map((r) => ({ ...mapOrg(r), role: r.role, memberCount: r.member_count }));
}

export async function getOrg(app: AppContext, orgId: string, userId: string): Promise<{ org: Organization; role: OrgRole }> {
  const role = await getOrgRole(app, orgId, userId);
  if (!role) throw notFound('Organization not found');
  const { rows } = await app.db.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
  if (!rows[0]) throw notFound('Organization not found');
  return { org: mapOrg(rows[0]), role };
}

export async function renameOrg(app: AppContext, ctx: AuthContext, orgId: string, name: string): Promise<Organization> {
  await requireOrgRole(app, orgId, ctx.userId, ['owner', 'admin']);
  const { rows } = await app.db.query('UPDATE organizations SET name = $1 WHERE id = $2 RETURNING *', [name, orgId]);
  if (!rows[0]) throw notFound('Organization not found');
  // Keep the org-level scope's display name in sync.
  await app.db.query(`UPDATE scopes SET name = $1 WHERE org_id = $2 AND type = 'organization'`, [name, orgId]);
  await logAudit(app, {
    action: 'org.update',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId,
    details: { name },
  });
  return mapOrg(rows[0]);
}

function mapMember(row: any): OrgMember {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    joinedAt: row.created_at.toISOString(),
  };
}

export async function listOrgMembers(app: AppContext, orgId: string, userId: string): Promise<OrgMember[]> {
  const role = await getOrgRole(app, orgId, userId);
  if (!role) throw notFound('Organization not found');
  const { rows } = await app.db.query(
    `SELECT om.user_id, om.role, om.created_at, u.email, u.name
     FROM org_members om JOIN users u ON u.id = om.user_id
     WHERE om.org_id = $1 ORDER BY om.created_at`,
    [orgId],
  );
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
  const { rows: users } = await app.db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!users[0]) throw notFound(`No Echo account exists for ${email} — they need to sign up first`);
  const user = users[0];
  const inserted = await app.db.query(
    `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING created_at`,
    [orgId, user.id, role],
  );
  if (!inserted.rowCount) throw conflict('That user is already a member of this organization');
  await logAudit(app, {
    action: 'org.member_add',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId,
    details: { memberEmail: email, role },
  });
  return { userId: user.id, email: user.email, name: user.name, role, joinedAt: inserted.rows[0].created_at.toISOString() };
}

async function countOwners(app: AppContext, orgId: string): Promise<number> {
  const { rows } = await app.db.query(
    `SELECT count(*)::int AS n FROM org_members WHERE org_id = $1 AND role = 'owner'`,
    [orgId],
  );
  return rows[0].n;
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
  const { rows } = await app.db.query(
    `UPDATE org_members om SET role = $1
     FROM users u
     WHERE om.org_id = $2 AND om.user_id = $3 AND u.id = om.user_id
     RETURNING om.user_id, om.role, om.created_at, u.email, u.name`,
    [newRole, orgId, targetUserId],
  );
  await logAudit(app, {
    action: 'org.member_update',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId,
    details: { targetUserId, role: newRole },
  });
  return mapMember(rows[0]);
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
  await app.db.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, targetUserId]);
  // Also drop them from every scope inside the org.
  await app.db.query(
    `DELETE FROM scope_members sm USING scopes s
     WHERE sm.scope_id = s.id AND s.org_id = $1 AND sm.user_id = $2`,
    [orgId, targetUserId],
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
  const { rows } = await app.db.query(
    'INSERT INTO scopes (type, name, org_id) VALUES ($1, $2, $3) RETURNING id',
    [input.type, input.name, input.orgId],
  );
  const scopeId = rows[0].id;
  await app.db.query('INSERT INTO scope_members (scope_id, user_id) VALUES ($1, $2)', [scopeId, ctx.userId]);
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

async function getOrgScopeOrThrow(app: AppContext, scopeId: string): Promise<{ id: string; type: string; name: string; org_id: string }> {
  const { rows } = await app.db.query('SELECT id, type, name, org_id FROM scopes WHERE id = $1', [scopeId]);
  if (!rows[0] || !rows[0].org_id) throw notFound('Scope not found');
  return rows[0];
}

export async function deleteOrgScope(app: AppContext, ctx: AuthContext, scopeId: string): Promise<void> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  if (scope.type === 'organization') throw badRequest('The organization scope cannot be deleted');
  await requireOrgRole(app, scope.org_id, ctx.userId, ['owner', 'admin']);
  await app.db.query('DELETE FROM scopes WHERE id = $1', [scopeId]); // memories cascade
  await logAudit(app, {
    action: 'scope.delete',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: scope.org_id,
    scopeId,
    details: { name: scope.name, type: scope.type },
  });
}

export async function listScopeMembers(app: AppContext, ctx: AuthContext, scopeId: string): Promise<ScopeMember[]> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  const role = await getOrgRole(app, scope.org_id, ctx.userId);
  if (!role) throw notFound('Scope not found');
  const { rows } = await app.db.query(
    `SELECT sm.user_id, sm.created_at, u.email, u.name
     FROM scope_members sm JOIN users u ON u.id = sm.user_id
     WHERE sm.scope_id = $1 ORDER BY sm.created_at`,
    [scopeId],
  );
  return rows.map((r) => ({ userId: r.user_id, email: r.email, name: r.name, addedAt: r.created_at.toISOString() }));
}

export async function addScopeMember(app: AppContext, ctx: AuthContext, scopeId: string, email: string): Promise<ScopeMember> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  if (scope.type === 'organization') throw badRequest('Organization scope membership is the org member list');
  await requireOrgRole(app, scope.org_id, ctx.userId, ['owner', 'admin']);
  const { rows: users } = await app.db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!users[0]) throw notFound(`No Echo account exists for ${email}`);
  const memberRole = await getOrgRole(app, scope.org_id, users[0].id);
  if (!memberRole) throw badRequest('That user must be a member of the organization first');
  const inserted = await app.db.query(
    'INSERT INTO scope_members (scope_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING created_at',
    [scopeId, users[0].id],
  );
  if (!inserted.rowCount) throw conflict('That user is already a member of this scope');
  await logAudit(app, {
    action: 'scope.member_add',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: scope.org_id,
    scopeId,
    details: { memberEmail: email },
  });
  return {
    userId: users[0].id,
    email: users[0].email,
    name: users[0].name,
    addedAt: inserted.rows[0].created_at.toISOString(),
  };
}

export async function removeScopeMember(app: AppContext, ctx: AuthContext, scopeId: string, targetUserId: string): Promise<void> {
  const scope = await getOrgScopeOrThrow(app, scopeId);
  await requireOrgRole(app, scope.org_id, ctx.userId, ['owner', 'admin']);
  const res = await app.db.query('DELETE FROM scope_members WHERE scope_id = $1 AND user_id = $2', [
    scopeId,
    targetUserId,
  ]);
  if (!res.rowCount) throw notFound('That user is not a member of this scope');
  await logAudit(app, {
    action: 'scope.member_remove',
    actorUserId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    sourceApp: ctx.sourceApp,
    orgId: scope.org_id,
    scopeId,
    details: { targetUserId },
  });
}
