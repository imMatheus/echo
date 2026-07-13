import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Building2Icon, PlusIcon } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type {
  OrgMember,
  OrgRole,
  OrgScopeType,
  Organization,
  ScopeMember,
  ScopeWithAccess,
} from '@echo/shared';
import { ORG_SCOPE_TYPES } from '@echo/shared';
import type { AuditQuery } from '@/api';
import * as api from '@/api';
import { ApiRequestError, errorMessage } from '@/api';
import { AuditTable } from '@/components/AuditTable';
import { RoleBadge, ScopeBadge } from '@/components/Badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { MemoryBrowser } from '@/components/MemoryBrowser';
import { PageHeader } from '@/components/PageHeader';
import { PageLoading } from '@/components/PageLoading';
import { RelativeTime } from '@/components/RelativeTime';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const TABS = ['memories', 'members', 'scopes', 'audit', 'settings'] as const;
type Tab = (typeof TABS)[number];

const ROLE_ITEMS = [
  { value: 'member', label: 'member' },
  { value: 'admin', label: 'admin' },
  { value: 'owner', label: 'owner' },
];

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = id ?? '';
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
  }, [orgId]);

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
  }, [orgId]);

  if (loading) return <PageLoading />;

  if (notFound || !org) {
    return (
      <EmptyState
        icon={<Building2Icon />}
        title="Organization not found"
        description="It may have been deleted, or you are not a member."
        action={
          <Link to="/orgs" className={cn(buttonVariants({ variant: 'outline' }))}>
            Back to organizations
          </Link>
        }
      />
    );
  }

  const isAdmin = role === 'owner' || role === 'admin';

  return (
    <div>
      <PageHeader
        title={org.name}
        titleExtra={<RoleBadge role={role} />}
        backLink={
          <Link to="/orgs" className="text-xs text-muted-foreground hover:text-foreground">
            ← Organizations
          </Link>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setSearchParams(value === 'memories' ? {} : { tab: value as string })}
        className="mb-5"
      >
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === 'memories' &&
        (scopes === null ? (
          <PageLoading />
        ) : scopes.length === 0 ? (
          <Alert>
            <AlertTitle>This organization has no scopes you can access.</AlertTitle>
          </Alert>
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
          <Alert>
            <AlertTitle>Only organization admins and owners can view the audit log.</AlertTitle>
          </Alert>
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
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);

  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const load = useCallback(() => {
    api
      .listOrgMembers(orgId)
      .then((res) => setMembers(res.members))
      .catch((err) => toast.error(errorMessage(err)));
  }, [orgId]);

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
        <div className="mb-3.5 flex justify-end">
          <Button onClick={() => setShowAdd(true)}>
            <PlusIcon data-icon="inline-start" />
            Add member
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              {isAdmin && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              // only owners can grant/revoke owner
              const roleItems = ROLE_ITEMS.filter(
                (item) => item.value !== 'owner' || myRole === 'owner' || member.role === 'owner',
              );
              return (
                <TableRow key={member.userId}>
                  <TableCell className="font-semibold">{member.name}</TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select
                        items={roleItems}
                        value={member.role}
                        onValueChange={(v) => void changeRole(member, v as OrgRole)}
                      >
                        <SelectTrigger size="sm" aria-label={`Role for ${member.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roleItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime date={member.joinedAt} />
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <Button variant="destructive" size="sm" onClick={() => setRemoveTarget(member)}>
                        Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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

  const roleItems = ROLE_ITEMS.filter((item) => item.value !== 'owner' || myRole === 'owner');

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="member-email">Email</FieldLabel>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                autoFocus
                required
              />
              <FieldDescription>They must already have an account on this Echo server.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="member-role">Role</FieldLabel>
              <Select items={roleItems} value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                <SelectTrigger id="member-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Add member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
        <div className="mb-3.5 flex justify-end">
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon data-icon="inline-start" />
            New scope
          </Button>
        </div>
      )}

      {subScopes.length === 0 ? (
        <EmptyState
          icon={<Building2Icon />}
          title="No workspace, team, or project scopes"
          description="Scopes carve the organization into smaller shared-memory spaces with their own membership."
          action={
            isAdmin ? (
              <Button onClick={() => setShowCreate(true)}>
                <PlusIcon data-icon="inline-start" />
                New scope
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {subScopes.map((scope) => (
            <Card key={scope.id} size="sm">
              <CardContent>
                <div className="flex flex-wrap items-center gap-2.5">
                  <ScopeBadge type={scope.type} />
                  <strong className="text-xs font-semibold">{scope.name}</strong>
                  <span className="text-xs text-muted-foreground">
                    {scope.memoryCount} memor{scope.memoryCount === 1 ? 'y' : 'ies'}
                  </span>
                  <span className="flex-1" />
                  {isAdmin && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedId(expandedId === scope.id ? null : scope.id)}
                      >
                        {expandedId === scope.id ? 'Hide members' : 'Members'}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(scope)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
                {isAdmin && expandedId === scope.id && <ScopeMembers scopeId={scope.id} />}
              </CardContent>
            </Card>
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
  const [members, setMembers] = useState<ScopeMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listScopeMembers(scopeId)
      .then((res) => setMembers(res.members))
      .catch((err) => toast.error(errorMessage(err)));
  }, [scopeId]);

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
    <div className="mt-3 border-t pt-3">
      {members === null ? (
        <Spinner />
      ) : (
        <>
          {members.length === 0 && <div className="text-xs text-muted-foreground">No members yet.</div>}
          {members.map((member) => (
            <div key={member.userId} className="flex items-center gap-2.5 py-1.5 text-xs/relaxed">
              <strong className="font-semibold">{member.name}</strong>
              <span className="text-muted-foreground">{member.email}</span>
              <span className="text-muted-foreground">
                added <RelativeTime date={member.addedAt} />
              </span>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => void remove(member)}>
                Remove
              </Button>
            </div>
          ))}
        </>
      )}
      <form className="mt-2.5 flex items-center gap-2" onSubmit={(e) => void add(e)}>
        <Input
          className="max-w-70"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Add org member by email"
          aria-label="Add org member by email"
        />
        <Button variant="outline" size="sm" type="submit" disabled={pending || !email.trim()}>
          {pending ? <Spinner /> : 'Add'}
        </Button>
      </form>
      {error && (
        <Alert variant="destructive" className="mt-2.5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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

  const typeItems = ORG_SCOPE_TYPES.map((t) => ({ value: t, label: t }));

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New scope</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="scope-type">Type</FieldLabel>
              <Select items={typeItems} value={type} onValueChange={(v) => setType(v as OrgScopeType)}>
                <SelectTrigger id="scope-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="scope-name">Name</FieldLabel>
              <Input
                id="scope-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Platform Team"
                autoFocus
                required
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create scope
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
    <Card className="max-w-120">
      <CardHeader>
        <CardTitle>Organization settings</CardTitle>
      </CardHeader>
      <CardContent>
        {isAdmin ? (
          <form onSubmit={(e) => void submit(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="org-rename">Name</FieldLabel>
                <Input id="org-rename" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field>
                <FieldLabel>Slug</FieldLabel>
                <div className="font-mono text-xs text-muted-foreground">{org.slug}</div>
              </Field>
              <Field>
                <FieldLabel>Created</FieldLabel>
                <div className="text-xs/relaxed">
                  <RelativeTime date={org.createdAt} />
                </div>
              </Field>
              <Field>
                <Button
                  type="submit"
                  className="w-fit"
                  disabled={pending || !name.trim() || name.trim() === org.name}
                >
                  {pending && <Spinner />}
                  Save changes
                </Button>
              </Field>
            </FieldGroup>
          </form>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel>Name</FieldLabel>
              <div className="text-xs/relaxed">{org.name}</div>
            </Field>
            <Field>
              <FieldLabel>Slug</FieldLabel>
              <div className="font-mono text-xs text-muted-foreground">{org.slug}</div>
            </Field>
            <Alert>
              <AlertTitle>Only organization admins and owners can change settings.</AlertTitle>
            </Alert>
          </FieldGroup>
        )}
      </CardContent>
    </Card>
  );
}
