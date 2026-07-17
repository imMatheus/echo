import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Building2Icon, PlusIcon } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import type { OrgMember, OrgRole, OrgScopeType, Organization, ScopeMember, ScopeWithAccess } from '@echo/shared';
import { ORG_SCOPE_TYPES } from '@echo/shared';
import type { AuditQuery } from '@/api';
import * as api from '@/api';
import { ApiRequestError, errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { isAuthorizationDependentKey, keys, useOrg, useOrgMembers, useScopeMembers, useScopes } from '@/hooks';
import { AuditTable } from '@/components/AuditTable';
import { RoleBadge, ScopeBadge } from '@/components/Badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { MemoryBrowser } from '@/components/MemoryBrowser';
import { PageHeader } from '@/components/PageHeader';
import { RelativeTime } from '@/components/RelativeTime';
import { RequestErrorState } from '@/components/RequestErrorState';
import { AuditListSkeleton, MemoryFiltersSkeleton, MemoryGridSkeleton, TableSkeleton } from '@/components/Skeletons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const TABS = ['memories', 'members', 'scopes', 'audit', 'settings'] as const;
type Tab = (typeof TABS)[number];

const isScopeMembersCacheKey = (key: unknown): boolean => Array.isArray(key) && key[0] === 'scope:members';

const ROLE_ITEMS = [
  { value: 'member', label: 'Member' },
  { value: 'owner', label: 'Owner' },
];

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = id ?? '';
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'memories';

  const { data: orgData, error, isLoading: orgLoading, mutate: mutateOrg } = useOrg(orgId);
  const { data: allScopes, error: scopesError, isLoading: scopesLoading, mutate: mutateScopes } = useScopes();

  const org = orgData?.org ?? null;
  const role: OrgRole = orgData?.role ?? 'member';
  const scopes: ScopeWithAccess[] | null = allScopes ? allScopes.filter((s) => s.orgId === orgId) : null;
  const notFound =
    (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) ||
    Boolean(org && allScopes && !allScopes.some((scope) => scope.orgId === orgId));

  const tabsNav = (
    <Tabs
      value={tab}
      onValueChange={(value) => setSearchParams(value === 'memories' ? {} : { tab: value as string })}
      className="mb-5"
    >
      <TabsList className="max-w-full justify-start overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <TabsTrigger key={t} value={t}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  const backLink = (
    <Link to="/orgs" className="text-xs text-muted-foreground hover:text-foreground">
      ← Organizations
    </Link>
  );

  if (orgLoading || scopesLoading) {
    // The org name and role are still in flight, but the back link and tab
    // strip are static — keep them usable and skeleton only the data areas.
    return (
      <div>
        <PageHeader title={<Skeleton className="h-7 w-44" />} backLink={backLink} />
        {tabsNav}
        <OrgTabSkeleton tab={tab} />
      </div>
    );
  }

  if (!notFound && ((!org && error) || (!allScopes && scopesError))) {
    const loadError = !org && error && !notFound ? error : scopesError;
    return (
      <RequestErrorState
        error={loadError}
        onRetry={async () => {
          await Promise.all([mutateOrg(), mutateScopes()]);
        }}
      />
    );
  }

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

  // Scope access refreshes are the privacy boundary and can arrive before the
  // org-role request. Never keep rendering cached owner controls/audit data if
  // the current scope snapshot already says management was revoked.
  const isOwner = role === 'owner' && (scopes?.some((scope) => scope.canManage) ?? true);

  return (
    <div>
      <PageHeader title={org.name} titleExtra={<RoleBadge role={role} />} backLink={backLink} />

      {tabsNav}

      {tab === 'memories' &&
        (scopes === null ? (
          <OrgTabSkeleton tab="memories" />
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

      {tab === 'members' && <MembersTab orgId={orgId} canManage={isOwner} />}

      {tab === 'scopes' && (
        <ScopesTab orgId={orgId} scopes={scopes ?? []} isOwner={isOwner} onChanged={() => void mutateScopes()} />
      )}

      {tab === 'audit' &&
        (isOwner ? (
          <OrgAudit orgId={orgId} />
        ) : (
          <Alert>
            <AlertTitle>Only organization owners can view the audit log.</AlertTitle>
          </Alert>
        ))}

      {tab === 'settings' && <SettingsTab org={org} isOwner={isOwner} />}
    </div>
  );
}

/** Loading stand-in shaped like whichever tab is selected. */
function OrgTabSkeleton({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'memories':
      return (
        <div>
          <MemoryFiltersSkeleton />
          <MemoryGridSkeleton count={6} />
        </div>
      );
    case 'members':
      return <TableSkeleton rows={4} />;
    case 'audit':
      return <AuditListSkeleton />;
    case 'scopes':
      return (
        <div className="flex flex-col gap-2.5" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      );
    case 'settings':
      return <Skeleton className="h-72 max-w-120 rounded-xl" aria-hidden />;
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function MembersTab({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { data: members, error, mutate: mutateMembers } = useOrgMembers(orgId);
  const { mutate } = useSWRConfig();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  const changeRole = async (member: OrgMember, newRole: OrgRole) => {
    if (newRole === member.role) return;
    setChangingRoleId(member.userId);
    try {
      await api.updateOrgMember(orgId, member.userId, { role: newRole });
      toast.success(`${member.name} is now ${newRole}`);
      const selfLostManagement = member.userId === user?.id && member.role !== 'member' && newRole === 'member';
      if (selfLostManagement) {
        // A demotion can revoke nested-scope and audit access. Never leave
        // permission-derived snapshots from the old role in the cache.
        await mutate(isAuthorizationDependentKey, undefined, { revalidate: false });
      }
      await Promise.allSettled([mutateMembers(), mutate(keys.org(orgId)), mutate(keys.orgs), mutate(keys.scopes)]);
    } catch (err) {
      toast.error(errorMessage(err));
      await mutateMembers().catch(() => undefined); // reset the select to the server state
    } finally {
      setChangingRoleId(null);
    }
  };

  const removeMember = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    const leavingSelf = target.userId === user?.id;
    try {
      await api.removeOrgMember(orgId, target.userId);
      toast.success(leavingSelf ? 'You left the organization' : `Removed ${target.name}`);
      if (leavingSelf) {
        await mutate(isAuthorizationDependentKey, undefined, { revalidate: false });
        await Promise.allSettled([mutate(keys.orgs), mutate(keys.scopes)]);
        navigate('/orgs', { replace: true });
      } else {
        await Promise.allSettled([
          mutateMembers(),
          mutate(keys.org(orgId)),
          mutate(keys.orgs),
          mutate(keys.scopes),
          mutate(isScopeMembersCacheKey),
        ]);
      }
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  if (!members && error) return <RequestErrorState error={error} onRetry={() => mutateMembers()} />;
  if (!members) {
    return (
      <div>
        {canManage && (
          <div className="mb-3.5 flex justify-end">
            <Button disabled>
              <PlusIcon data-icon="inline-start" />
              Add member
            </Button>
          </div>
        )}
        <TableSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div>
      {canManage && (
        <div className="mb-3.5 flex justify-end">
          <Button onClick={() => setShowAdd(true)}>
            <PlusIcon data-icon="inline-start" />
            Add member
          </Button>
        </div>
      )}

      <ul className="grid gap-2 sm:hidden">
        {members.map((member) => {
          const isSelf = member.userId === user?.id;
          return (
            <li key={member.userId} className="rounded-xl border bg-card p-4 shadow-card dark:shadow-none">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{member.name}</div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{member.email}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="mb-1 text-muted-foreground">Role</div>
                  {canManage ? (
                    <Select
                      items={ROLE_ITEMS}
                      value={member.role}
                      onValueChange={(v) => void changeRole(member, v as OrgRole)}
                      disabled={changingRoleId !== null}
                    >
                      <SelectTrigger className="w-full" aria-label={`Role for ${member.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}
                </div>
                <div>
                  <div className="mb-1 text-muted-foreground">Joined</div>
                  <div className="flex h-10 items-center">
                    <RelativeTime date={member.joinedAt} />
                  </div>
                </div>
              </div>
              {(isSelf || canManage) && (
                <Button
                  variant="destructive"
                  className="mt-4 w-full"
                  onClick={() => setRemoveTarget(member)}
                  disabled={changingRoleId !== null}
                >
                  {isSelf ? 'Leave organization' : 'Remove member'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-card max-sm:hidden dark:shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isSelf = member.userId === user?.id;
              return (
                <TableRow key={member.userId}>
                  <TableCell className="font-semibold">{member.name}</TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <Select
                        items={ROLE_ITEMS}
                        value={member.role}
                        onValueChange={(v) => void changeRole(member, v as OrgRole)}
                        disabled={changingRoleId !== null}
                      >
                        <SelectTrigger size="sm" aria-label={`Role for ${member.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_ITEMS.map((item) => (
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
                  <TableCell className="text-right">
                    {(isSelf || canManage) && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setRemoveTarget(member)}
                        disabled={changingRoleId !== null}
                      >
                        {isSelf ? 'Leave' : 'Remove'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {canManage && showAdd && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          onAdd={async (email, memberRole) => {
            await api.addOrgMember(orgId, { email, role: memberRole });
            toast.success(`Added ${email}`);
            setShowAdd(false);
            await Promise.allSettled([
              mutateMembers(),
              mutate(keys.org(orgId)),
              mutate(keys.orgs),
              mutate(keys.scopes),
            ]);
          }}
        />
      )}

      {removeTarget && (removeTarget.userId === user?.id || canManage) && (
        <ConfirmDialog
          title={removeTarget.userId === user?.id ? 'Leave organization?' : 'Remove member?'}
          message={
            <>
              {removeTarget.userId === user?.id ? (
                <>You will lose access to this organization&rsquo;s memories and scopes.</>
              ) : (
                <>
                  <strong>{removeTarget.name}</strong> ({removeTarget.email}) will lose access to this
                  organization&rsquo;s memories and scopes.
                </>
              )}
            </>
          }
          confirmLabel={removeTarget.userId === user?.id ? 'Leave organization' : 'Remove'}
          onConfirm={removeMember}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

function AddMemberModal({
  onClose,
  onAdd,
}: {
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
          `No verified Echo account exists for “${email.trim()}”. The user must sign up and verify their email first — Echo does not send organization invitations.`,
        );
      } else {
        setError(errorMessage(err));
      }
      setPending(false);
    }
  };

  return (
    <Dialog open disablePointerDismissal={pending} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent showCloseButton={!pending}>
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
            <Alert>
              <AlertTitle>Only verified Echo accounts can be added.</AlertTitle>
              <AlertDescription>
                Echo does not send organization invitations; the user must create and verify their account first.
              </AlertDescription>
            </Alert>
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
                maxLength={254}
              />
              <FieldDescription>They must already have an account on this Echo server.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="member-role">Role</FieldLabel>
              <Select items={ROLE_ITEMS} value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                <SelectTrigger id="member-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Members can use shared memories. Owners can also manage members, scopes, audit, and settings.
              </FieldDescription>
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
  isOwner,
  onChanged,
}: {
  orgId: string;
  scopes: ScopeWithAccess[];
  isOwner: boolean;
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
      {isOwner && (
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
            isOwner ? (
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
                <div className="flex flex-wrap items-center gap-2.5 max-sm:items-start">
                  <ScopeBadge type={scope.type} />
                  <strong className="text-xs font-semibold">{scope.name}</strong>
                  <span className="text-xs text-muted-foreground">
                    {scope.memoryCount} memor{scope.memoryCount === 1 ? 'y' : 'ies'}
                  </span>
                  <span className="flex-1 max-sm:basis-full" />
                  {isOwner && (
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
                {isOwner && expandedId === scope.id && <ScopeMembers scopeId={scope.id} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isOwner && showCreate && (
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

      {isOwner && deleteTarget && (
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
  const { data: members, error: membersError, mutate } = useScopeMembers(scopeId);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return;
    setPending(true);
    try {
      await api.addScopeMember(scopeId, email.trim());
      toast.success(`Added ${email.trim()}`);
      setEmail('');
      await mutate();
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
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="mt-3 border-t pt-3">
      {members == null && membersError ? (
        <RequestErrorState error={membersError} onRetry={() => mutate()} title="Could not load scope members" />
      ) : members == null ? (
        <div aria-hidden>
          <div className="flex h-8 items-center">
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <div className="flex h-8 items-center">
            <Skeleton className="h-3.5 w-52 max-w-full" />
          </div>
        </div>
      ) : (
        <>
          {members.length === 0 && <div className="text-xs text-muted-foreground">No members yet.</div>}
          {members.map((member) => (
            <div key={member.userId} className="flex flex-wrap items-center gap-2.5 py-1.5 text-xs/relaxed">
              <strong className="font-semibold">{member.name}</strong>
              <span className="break-all text-muted-foreground">{member.email}</span>
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
      <form
        className="mt-2.5 flex flex-wrap items-center gap-2 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(e) => void add(e)}
      >
        <Input
          className="max-w-70 max-sm:max-w-none"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Add org member by email"
          aria-label="Add org member by email"
          maxLength={254}
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
    <Dialog open disablePointerDismissal={pending} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent showCloseButton={!pending}>
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
                maxLength={100}
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
  // Auth and API-key events never carry an org id, so their chips would
  // always be empty here.
  return (
    <AuditTable fetchPage={fetchPage} scopeKey={`org:${orgId}`} categories={['memory', 'org', 'scope']} showActor />
  );
}

function SettingsTab({ org, isOwner }: { org: Organization; isOwner: boolean }) {
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const [name, setName] = useState(org.name);
  const [pending, setPending] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const deleteOrganization = async () => {
    try {
      await api.deleteOrg(org.id);
      toast.success(`Deleted “${org.name}”`);
      // Deleting the org revokes access to all of its scopes and memories —
      // drop every permission-derived snapshot before navigating away.
      await mutate(isAuthorizationDependentKey, undefined, { revalidate: false });
      await Promise.allSettled([mutate(keys.orgs), mutate(keys.scopes)]);
      navigate('/orgs', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === org.name) return;
    setPending(true);
    try {
      await api.updateOrg(org.id, { name: name.trim() });
      // The server also renames the organization-level scope, so refresh every
      // cached label that can surface the old name.
      await Promise.allSettled([mutate(keys.org(org.id)), mutate(keys.orgs), mutate(keys.scopes)]);
      toast.success('Organization renamed');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex max-w-120 flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Organization settings</CardTitle>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <form onSubmit={(e) => void submit(e)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="org-rename">Name</FieldLabel>
                  <Input
                    id="org-rename"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                  />
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
              <Alert>
                <AlertTitle>Only organization owners can change settings.</AlertTitle>
              </Alert>
            </FieldGroup>
          )}
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <p className="text-xs/relaxed text-muted-foreground">
                Permanently delete this organization, its scopes, and every memory in them.
              </p>
              <Button variant="destructive" onClick={() => setShowDelete(true)}>
                Delete organization
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isOwner && showDelete && (
        <ConfirmDialog
          title="Delete organization?"
          message={
            <>
              Deleting <strong>{org.name}</strong> permanently deletes all of its scopes and memories, and removes every
              member. This cannot be undone.
            </>
          }
          confirmLabel="Delete organization"
          onConfirm={deleteOrganization}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
