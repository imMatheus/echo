import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Memory } from '@echo/shared';
import * as api from '../api';
import { ApiRequestError, errorMessage } from '../api';
import { KindBadge, ScopeBadge, SensitivityBadge, SourceChip, Tag } from '../components/Badge';
import { CopyButton } from '../components/CodeBlock';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { RelativeTime } from '../components/RelativeTime';
import { PageLoading, Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { EmptyMemoriesIcon } from '../components/icons';

export default function MemoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [memory, setMemory] = useState<Memory | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  // content editing
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // tag editing
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    api
      .getMemory(id)
      .then((res) => {
        if (!cancelled) setMemory(res.memory);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 404) setNotFound(true);
        else toast.error(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, toast]);

  if (loading) return <PageLoading />;

  if (notFound || !memory) {
    return (
      <EmptyState
        icon={<EmptyMemoriesIcon />}
        title="Memory not found"
        description="This memory may have been deleted or expired."
        action={
          <Link to="/" className="btn">
            Back to memories
          </Link>
        }
      />
    );
  }

  const startEdit = () => {
    setDraft(memory.content);
    setEditing(true);
  };

  const saveContent = async () => {
    const content = draft.trim();
    if (!content) {
      toast.error('Content cannot be empty');
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateMemory(memory.id, { content });
      setMemory(res.memory);
      setEditing(false);
      toast.success('Memory updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const startEditTags = () => {
    setTagsDraft(memory.tags.join(', '));
    setEditingTags(true);
  };

  const saveTags = async () => {
    const tags = tagsDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    setSavingTags(true);
    try {
      const res = await api.updateMemory(memory.id, { tags });
      setMemory(res.memory);
      setEditingTags(false);
      toast.success('Tags updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingTags(false);
    }
  };

  const deleteMemory = async () => {
    try {
      await api.deleteMemory(memory.id);
      toast.success('Memory deleted');
      navigate('/');
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const hasMetadata = Object.keys(memory.metadata).length > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <Link to="/" className="muted small">
              ← Memories
            </Link>
          </div>
          <h1>Memory</h1>
        </div>
        <span className="spacer" />
        {!editing && (
          <button type="button" className="btn" onClick={startEdit}>
            Edit
          </button>
        )}
      </div>

      <div className="card">
        {editing ? (
          <div>
            <textarea
              className="textarea"
              style={{ minHeight: 160 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveContent()} disabled={saving}>
                {saving && <Spinner size={13} />}
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="memory-detail-content">{memory.content}</p>
        )}
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Details</h2>
        </div>
        <dl className="meta-grid">
          <div className="meta-item">
            <dt>Scope</dt>
            <dd>
              <ScopeBadge type={memory.scopeType} name={memory.scopeName} />
            </dd>
          </div>
          <div className="meta-item">
            <dt>Kind</dt>
            <dd>
              <KindBadge kind={memory.kind} />
            </dd>
          </div>
          <div className="meta-item">
            <dt>Confidence</dt>
            <dd>{memory.confidence}</dd>
          </div>
          <div className="meta-item">
            <dt>Sensitivity</dt>
            <dd>
              {memory.sensitivity === 'normal' ? (
                'normal'
              ) : (
                <SensitivityBadge sensitivity={memory.sensitivity} />
              )}
            </dd>
          </div>
          <div className="meta-item">
            <dt>Source app</dt>
            <dd>
              <SourceChip app={memory.sourceApp} />
            </dd>
          </div>
          <div className="meta-item">
            <dt>Created by</dt>
            <dd>{memory.createdByName ?? <span className="muted">—</span>}</dd>
          </div>
          <div className="meta-item">
            <dt>Created</dt>
            <dd>
              <RelativeTime date={memory.createdAt} />
            </dd>
          </div>
          <div className="meta-item">
            <dt>Updated</dt>
            <dd>
              <RelativeTime date={memory.updatedAt} />
            </dd>
          </div>
          <div className="meta-item">
            <dt>Expires</dt>
            <dd>{memory.expiresAt ? <RelativeTime date={memory.expiresAt} /> : <span className="muted">Never</span>}</dd>
          </div>
          <div className="meta-item">
            <dt>Embedding model</dt>
            <dd>
              {memory.embeddingModel ? (
                <span className="mono">{memory.embeddingModel}</span>
              ) : (
                <span className="muted">none</span>
              )}
            </dd>
          </div>
          <div className="meta-item full">
            <dt>Memory ID</dt>
            <dd>
              <span className="mono">{memory.id}</span>
              <CopyButton text={memory.id} label="Copy memory ID" />
            </dd>
          </div>
          <div className="meta-item full">
            <dt>Tags</dt>
            <dd>
              {editingTags ? (
                <div className="row" style={{ width: '100%' }}>
                  <input
                    className="input"
                    value={tagsDraft}
                    onChange={(e) => setTagsDraft(e.target.value)}
                    placeholder="comma, separated, tags"
                    autoFocus
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-sm" onClick={() => setEditingTags(false)} disabled={savingTags}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void saveTags()}
                    disabled={savingTags}
                  >
                    {savingTags && <Spinner size={12} />}
                    Save
                  </button>
                </div>
              ) : (
                <>
                  {memory.tags.length === 0 && <span className="muted">No tags</span>}
                  {memory.tags.map((t) => (
                    <Tag key={t} tag={t} />
                  ))}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={startEditTags}>
                    Edit
                  </button>
                </>
              )}
            </dd>
          </div>
          {hasMetadata && (
            <div className="meta-item full">
              <dt>Metadata</dt>
              <dd>
                <pre className="details-json" style={{ width: '100%' }}>
                  {JSON.stringify(memory.metadata, null, 2)}
                </pre>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="card danger-zone">
        <div className="card-title-row">
          <h2>Danger zone</h2>
        </div>
        <div className="row">
          <span className="muted small">Deleting a memory removes it from every AI app connected to Echo.</span>
          <span className="spacer" />
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete memory
          </button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete memory?"
          message={
            <>
              This permanently deletes the memory
              {memory.content.length > 80 ? (
                <>
                  {' '}
                  starting with <em>“{memory.content.slice(0, 80)}…”</em>
                </>
              ) : (
                <>
                  {' '}
                  <em>“{memory.content}”</em>
                </>
              )}
              . Connected AI apps will no longer be able to recall it.
            </>
          }
          confirmLabel="Delete memory"
          onConfirm={deleteMemory}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
