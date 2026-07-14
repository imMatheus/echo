import { useState } from 'react';
import type { FormEvent } from 'react';
import { Building2Icon, PlusIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { slugify } from '@echo/shared';
import * as api from '@/api';
import { errorMessage } from '@/api';
import { keys, useOrgs } from '@/hooks';
import { RoleBadge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { PageLoading } from '@/components/PageLoading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

export default function OrgsPage() {
  const { data: orgs } = useOrgs();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="Share memories with your team through org, workspace, team, and project scopes."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon data-icon="inline-start" />
            New organization
          </Button>
        }
      />

      {!orgs ? (
        <PageLoading />
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={<Building2Icon />}
          title="No organizations"
          description="Create an organization to share context with teammates across your AI tools."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon data-icon="inline-start" />
              New organization
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          {orgs.map((org) => (
            <Link
              key={org.id}
              to={`/orgs/${org.id}`}
              className="block rounded-xl border bg-card p-4 transition-colors hover:border-ring/40 hover:bg-input/10"
            >
              <h3 className="mb-2 font-heading text-sm font-semibold tracking-tight">{org.name}</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <RoleBadge role={org.role} />
                <span>
                  {org.memberCount} member{org.memberCount === 1 ? '' : 's'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateOrgModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onNameChange = (value: string) => {
    setName(value);
    // slugify falls back to "org" on empty input; keep the preview blank instead.
    if (!slugTouched) setSlug(value.trim() ? slugify(value) : '');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setPending(true);
    try {
      const res = await api.createOrg({
        name: name.trim(),
        slug: slug.trim() || undefined,
      });
      void mutate(keys.orgs);
      toast.success(`Created ${res.org.name}`);
      navigate(`/orgs/${res.org.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="org-name">Name</FieldLabel>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Acme Inc."
                autoFocus
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
              <Input
                id="org-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
                }}
                placeholder="acme-inc"
              />
              <FieldDescription>A short URL-friendly identifier.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
