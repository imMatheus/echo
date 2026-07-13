import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type {
  OrgMember,
  OrgRole,
  OrgScopeType,
  Organization,
  ScopeMember,
  ScopeWithAccess,
} from '@echo/shared';
import { ORG_SCOPE_TYPES } from '@echo/shared';
import type { AuditQuery } from '../api';
import * as api from '../api';
import { ApiRequestError, errorMessage } from '../api';
import { AuditTable } from '../components/AuditTable';
import { RoleBadge, ScopeBadge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { MemoryBrowser } from '../components/MemoryBrowser';
import { Modal } from '../components/Modal';
import { RelativeTime } from '../components/RelativeTime';
import { PageLoading, Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { EmptyOrgIcon, IconPlus } from '../components/icons';

const TABS = ['memories', 'members', 'scopes', 'audit', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = id ?? '';
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'memories';

  const [org, setOrg] = useState<Organization | null>(null);
  const [role, setRole] = useState<OrgRole>('member');
  const [scopes, setScopes] = useState<ScopeWithAccess[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadScopes = useCallback(() => {
    return api
      .listScopes()
      .then((res) => setScopes(res.scopes.filter((s) => s.orgId === orgId)))
      .catch((err) => toast.error(errorMessage(err)));
  }, [orgId, toast]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getOrg(orgId), api.listScopes()])
      .then(([orgRes, scopesRes]) => {
        if (cancelled) return;
        setOrg(orgRes.org);
        setRole(orgRes.role);
        setScopes(scopesRes.scopes.filter((s) => s.orgId === orgId));
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && (err.status === 404 || err.status === 403)) setNotFound(true);
        else toast.error(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, toast]);

  if (loading) return <PageLoading />;

  if (notFound || !org) {
    return (
      <EmptyState
        icon={<EmptyOrgIcon />}
        title="Organization not found"
        description="It may have been deleted, or you are not a member."
        action={
          <Link to="/orgs" className="btn">
            Back to organizations
          </Link>
        }
      />
    );
  }

  const isAdmin = role === 'owner' || role === 'admin';

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <Link to="/orgs" className="muted small">
              ← Organizations
            </Link>
          </div>
          <div className="row">
            <h1>{org.name}</h1>
            <RoleBadge role={role} />
          </div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setSearchParams(t === 'memories' ? {} : { tab: t })}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'memories' &&
        (scopes === null ? (
          <PageLoading />
        ) : scopes.length === 0 ? (
          <div className="inline-note">This organization has no scopes you can access.</div>
        ) : (
          <MemoryBrowser
            key={orgId}
            scopes={scopes}
            allowAllScopes={false}
            defaultScopeId={scopes.find((s) => s.type === 'organization')?.id}
          />
        ))}

      {tab === 'members' && <MembersTab orgId={orgId} myRole={role} />}

      {tab === 'scopes' && (
        <ScopesTab orgId={orgId} scopes={scopes ?? []} isAdmin={isAdmin} onChanged={() => void loadScopes()} />
      )}

      {tab === 'audit' &&
        (isAdmin ? (
          <OrgAudit orgId={orgId} />
        ) : (
          <div className="inline-note">Only organization admins and owners can view the audit log.</div>
        ))}

      {tab === 'settings' && (
        <SettingsTab org={org} isAdmin={isAdmin} onRenamed={(updated) => setOrg(updated)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function MembersTab({ orgId, myRole }: { orgId: string; myRole: OrgRole }) {
  const toast = useToast();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);

  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const load = useCallback(() => {
    api
      .listOrgMembers(orgId)
      .then((res) => setMembers(res.members))
      .catch((err) => toast.error(errorMessage(err)));
  }, [orgId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (member: OrgMember, newRole: OrgRole) => {
    try {
      await api.updateOrgMember(orgId, member.userId, { role: newRole });
      toast.success(`${member.name} is now ${newRole}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
      load(); // reset the select to the server state
    }
  };

  const removeMember = async () => {
    if (!removeTarget) return;
    try {
      await api.removeOrgMember(orgId, removeTarget.userId);
      toast.success(`Removed ${removeTarget.name}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  if (members === null) return <PageLoading />;

  return (
    <div>
      {isAdmin && (
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <IconPlus />
            Add member
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td style={{ fontWeight: 600 }}>{member.name}</td>
                <td className="muted">{member.email}</td>
                <td>
                  {isAdmin ? (
                    <select
                      className="select"
                      style={{ width: 'auto', padding: '3px 26px 3px 8px', fontSize: 12.5 }}
                      value={member.role}
                      onChange={(e) => void changeRole(member, e.target.value as OrgRole)}
                      aria-label={`Role for ${member.name}`}
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                      {/* only owners can grant/revoke owner */}
                      {(myRole === 'owner' || member.role === 'owner') && <option value="owner">owner</option>}
                    </select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}
                </td>
                <td className="muted">
                  <RelativeTime date={member.joinedAt} />
                </td>
                {isAdmin && (
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setRemoveTarget(member)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddMemberModal
          myRole={myRole}
          onClose={() => setShowAdd(false)}
          onAdd={async (email, memberRole) => {
            await api.addOrgMember(orgId, { email, role: memberRole });
            toast.success(`Added ${email}`);
            setShowAdd(false);
            load();
          }}
        />
      )}

      {removeTarget && (
        <ConfirmDialog
          title="Remove member?"
          message={
            <>
              <strong>{removeTarget.name}</strong> ({removeTarget.email}) will lose access to this
              organization&rsquo;s memories and scopes.
            </>
          }
          confirmLabel="Remove"
          onConfirm={removeMember}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

function AddMemberModal({
  myRole,
  onClose,
  onAdd,
}: {
  myRole: OrgRole;
  onClose: () => void;
  onAdd: (email: string, role: OrgRole) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onAdd(email.trim(), role);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setError(
          `No Echo account exists for “${email.trim()}”. The user must sign up on this server first — Echo v1 does not send email invites.`,
        );
      } else {
        setError(errorMessage(err));
      }
      setPending(false);
    }
  };

  return (
    <Modal title="Add member" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="member-email">Email</label>
          <input
            id="member-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            autoFocus
            required
          />
          <div className="hint">They must already have an account on this Echo server.</div>
        </div>
        <div className="field">
          <label htmlFor="member-role">Role</label>
          <select id="member-role" className="select" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
            <option value="member">member</option>
            <option value="admin">admin</option>
            {myRole === 'owner' && <option value="owner">owner</option>}
          </select>
        </div>
        <div className="modal-footer" style={{ padding: '14px 0 0', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <Spinner size={13} />}
            Add member
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

function ScopesTab({
  orgId,
  scopes,
  isAdmin,
  onChanged,
}: {
  orgId: string;
  scopes: ScopeWithAccess[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScopeWithAccess | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const subScopes = scopes.filter((s) => s.type !== 'organization' && s.type !== 'personal');

  const removeScope = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteScope(deleteTarget.id);
      toast.success(`Deleted scope “${deleteTarget.name}”`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div>
      {isAdmin && (
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <IconPlus />
            New scope
          </button>
        </div>
      )}

      {subScopes.length === 0 ? (
        <EmptyState
          icon={<EmptyOrgIcon />}
          title="No workspace, team, or project scopes"
          description="Scopes carve the organization into smaller shared-memory spaces with their own membership."
          action={
            isAdmin ? (
              <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <IconPlus />
                New scope
              </button>
            ) : undefined
          }
        />
      ) : (
        <div>
          {subScopes.map((scope) => (
            <div key={scope.id} className="scope-card">
              <div className="scope-card-head">
                <ScopeBadge type={scope.type} />
                <strong>{scope.name}</strong>
                <span className="muted small">
                  {scope.memoryCount} memor{scope.memoryCount === 1 ? 'y' : 'ies'}
                </span>
                <span className="spacer" />
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setExpandedId(expandedId === scope.id ? null : scope.id)}
                    >
                      {expandedId === scope.id ? 'Hide members' : 'Members'}
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(scope)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
              {isAdmin && expandedId === scope.id && <ScopeMembers scopeId={scope.id} />}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateScopeModal
          onClose={() => setShowCreate(false)}
          onCreate={async (type, name) => {
            await api.createScope({ orgId, type, name });
            toast.success(`Created ${type} “${name}”`);
            setShowCreate(false);
            onChanged();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete scope?"
          message={
            <>
              Deleting <strong>{deleteTarget.name}</strong> permanently deletes its{' '}
              <strong>
                {deleteTarget.memoryCount} memor{deleteTarget.memoryCount === 1 ? 'y' : 'ies'}
              </strong>{' '}
              and removes all scope members. This cannot be undone.
            </>
          }
          confirmLabel="Delete scope"
          onConfirm={removeScope}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function ScopeMembers({ scopeId }: { scopeId: string }) {
  const toast = useToast();
  const [members, setMembers] = useState<ScopeMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listScopeMembers(scopeId)
      .then((res) => setMembers(res.members))
      .catch((err) => toast.error(errorMessage(err)));
  }, [scopeId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return;
    setPending(true);
    try {
      await api.addScopeMember(scopeId, email.trim());
      toast.success(`Added ${email.trim()}`);
      setEmail('');
      load();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setError('No matching user — they must already be a member of this organization.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  };

  const remove = async (member: ScopeMember) => {
    try {
      await api.removeScopeMember(scopeId, member.userId);
      toast.success(`Removed ${member.name}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="scope-members">
      {members === null ? (
        <Spinner size={16} />
      ) : (
        <>
          {members.length === 0 && <div className="muted small">No members yet.</div>}
          {members.map((member) => (
            <div key={member.userId} className="scope-member-row">
              <strong>{member.name}</strong>
              <span className="muted">{member.email}</span>
              <span className="muted small">
                added <RelativeTime date={member.addedAt} />
              </span>
              <span className="spacer" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(member)}>
                Remove
              </button>
            </div>
          ))}
        </>
      )}
      <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => void add(e)}>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Add org member by email"
          style={{ maxWidth: 280 }}
        />
        <button type="submit" className="btn btn-sm" disabled={pending || !email.trim()}>
          {pending ? <Spinner size={12} /> : 'Add'}
        </button>
      </form>
      {error && (
        <div className="form-error" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function CreateScopeModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (type: OrgScopeType, name: string) => Promise<void>;
}) {
  const [type, setType] = useState<OrgScopeType>('team');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setPending(true);
    try {
      await onCreate(type, name.trim());
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Modal title="New scope" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="scope-type">Type</label>
          <select
            id="scope-type"
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as OrgScopeType)}
          >
            {ORG_SCOPE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="scope-name">Name</label>
          <input
            id="scope-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Platform Team"
            autoFocus
            required
          />
        </div>
        <div className="modal-footer" style={{ padding: '14px 0 0', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <Spinner size={13} />}
            Create scope
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Audit + Settings
// ---------------------------------------------------------------------------

function OrgAudit({ orgId }: { orgId: string }) {
  const fetchPage = useCallback((q: AuditQuery) => api.getOrgAudit(orgId, q), [orgId]);
  return <AuditTable fetchPage={fetchPage} />;
}

function SettingsTab({
  org,
  isAdmin,
  onRenamed,
}: {
  org: Organization;
  isAdmin: boolean;
  onRenamed: (org: Organization) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(org.name);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === org.name) return;
    setPending(true);
    try {
      const res = await api.updateOrg(org.id, { name: name.trim() });
      onRenamed(res.org);
      toast.success('Organization renamed');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <div className="card-title-row">
        <h2>Organization settings</h2>
      </div>
      {isAdmin ? (
        <form onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="org-rename">Name</label>
            <input id="org-rename" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Slug</label>
            <div className="mono muted">{org.slug}</div>
          </div>
          <div className="field">
            <label>Created</label>
            <div>
              <RelativeTime date={org.createdAt} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={pending || !name.trim() || name.trim() === org.name}>
            {pending && <Spinner size={13} />}
            Save changes
          </button>
        </form>
      ) : (
        <div>
          <div className="field">
            <label>Name</label>
            <div>{org.name}</div>
          </div>
          <div className="field">
            <label>Slug</label>
            <div className="mono muted">{org.slug}</div>
          </div>
          <div className="inline-note">Only organization admins and owners can change settings.</div>
        </div>
      )}
    </div>
  );
}
