import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ApiKeyInfo } from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { SourceChip } from '../components/Badge';
import { CodeBlock } from '../components/CodeBlock';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { RelativeTime } from '../components/RelativeTime';
import { PageLoading, Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { EmptyKeyIcon, IconPlus } from '../components/icons';

export default function ApiKeysPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState<{ name: string; secret: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const load = useCallback(() => {
    api
      .listApiKeys()
      .then((res) => setKeys(res.keys))
      .catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      await api.revokeApiKey(revokeTarget.id);
      toast.success(`Revoked “${revokeTarget.name}”`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>API Keys</h1>
          <p className="subtitle">
            Keys let AI apps read and write your memories over MCP. See <Link to="/connect">Connect</Link> for
            setup instructions.
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <IconPlus />
          Create key
        </button>
      </div>

      {keys === null ? (
        <PageLoading />
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<EmptyKeyIcon />}
          title="No API keys"
          description="Create a key to connect Claude, Cursor, or any MCP client to your Echo memories."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <IconPlus />
              Create key
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Source app</th>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const revoked = key.revokedAt !== null;
                return (
                  <tr key={key.id} style={revoked ? { opacity: 0.6 } : undefined}>
                    <td style={{ fontWeight: 600 }}>{key.name}</td>
                    <td>
                      <SourceChip app={key.sourceApp} />
                    </td>
                    <td>
                      <span className="mono muted">{key.keyPrefix}</span>
                    </td>
                    <td className="muted">
                      <RelativeTime date={key.createdAt} />
                    </td>
                    <td className="muted">{key.lastUsedAt ? <RelativeTime date={key.lastUsedAt} /> : 'Never'}</td>
                    <td>
                      <span className={`badge badge-status-${revoked ? 'revoked' : 'active'}`}>
                        {revoked ? 'revoked' : 'active'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!revoked && (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => setRevokeTarget(key)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateKeyModal
          onClose={() => setShowCreate(false)}
          onCreated={(name, secret) => {
            setShowCreate(false);
            setNewSecret({ name, secret });
            load();
          }}
        />
      )}

      {newSecret && (
        <Modal title={`Key created: ${newSecret.name}`} onClose={() => setNewSecret(null)} width={560}>
          <div className="secret-warning">
            <span>⚠</span>
            <span>
              This is the only time the full key is shown. Copy it now and store it somewhere safe — Echo keeps
              only a hashed version.
            </span>
          </div>
          <CodeBlock code={newSecret.secret} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => setNewSecret(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Revoke API key?"
          message={
            <>
              Apps using <strong>{revokeTarget.name}</strong> ({revokeTarget.keyPrefix}) will immediately lose
              access. This cannot be undone.
            </>
          }
          confirmLabel="Revoke key"
          onConfirm={revoke}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}

function CreateKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string, secret: string) => void;
}) {
  const [name, setName] = useState('');
  const [sourceApp, setSourceApp] = useState('');
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
      const res = await api.createApiKey({
        name: name.trim(),
        sourceApp: sourceApp.trim() || undefined,
      });
      onCreated(res.key.name, res.secret);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Modal title="Create API key" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="key-name">Name</label>
          <input
            id="key-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Laptop — Claude Code"
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label htmlFor="key-source">Source app</label>
          <input
            id="key-source"
            className="input"
            value={sourceApp}
            onChange={(e) => setSourceApp(e.target.value)}
            placeholder="claude-code, cursor, chatgpt…"
          />
          <div className="hint">Label attached to memories written with this key.</div>
        </div>
        <div className="modal-footer" style={{ padding: '14px 0 0', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <Spinner size={13} />}
            Create key
          </button>
        </div>
      </form>
    </Modal>
  );
}
