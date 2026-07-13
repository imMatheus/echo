import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { OrganizationWithRole } from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { RoleBadge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { PageLoading, Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { EmptyOrgIcon, IconPlus } from '../components/icons';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function OrgsPage() {
  const toast = useToast();
  const [orgs, setOrgs] = useState<OrganizationWithRole[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    api
      .listOrgs()
      .then((res) => setOrgs(res.orgs))
      .catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Organizations</h1>
          <p className="subtitle">Share memories with your team through org, workspace, team, and project scopes.</p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <IconPlus />
          New organization
        </button>
      </div>

      {orgs === null ? (
        <PageLoading />
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={<EmptyOrgIcon />}
          title="No organizations"
          description="Create an organization to share context with teammates across your AI tools."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <IconPlus />
              New organization
            </button>
          }
        />
      ) : (
        <div className="org-grid">
          {orgs.map((org) => (
            <Link key={org.id} to={`/orgs/${org.id}`} className="org-card">
              <h3>{org.name}</h3>
              <div className="org-card-meta">
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
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
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
      toast.success(`Created ${res.org.name}`);
      navigate(`/orgs/${res.org.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Modal title="New organization" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="org-name">Name</label>
          <input
            id="org-name"
            className="input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Acme Inc."
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label htmlFor="org-slug">Slug</label>
          <input
            id="org-slug"
            className="input mono"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
            }}
            placeholder="acme-inc"
          />
          <div className="hint">A short URL-friendly identifier.</div>
        </div>
        <div className="modal-footer" style={{ padding: '14px 0 0', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <Spinner size={13} />}
            Create organization
          </button>
        </div>
      </form>
    </Modal>
  );
}
