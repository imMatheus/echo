import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateMemoryRequest,
  Memory,
  MemoryKind,
  ScopeWithAccess,
  Sensitivity,
} from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { Modal } from './Modal';
import { ScopeOptions } from './ScopeOptions';
import { Spinner } from './Spinner';

export function MemoryFormModal({
  scopes,
  defaultScopeId,
  onClose,
  onCreated,
}: {
  /** All scopes the modal may offer; only canWrite scopes are shown. */
  scopes: ScopeWithAccess[];
  defaultScopeId?: string;
  onClose: () => void;
  onCreated: (memory: Memory) => void;
}) {
  const writable = scopes.filter((s) => s.canWrite);

  const [content, setContent] = useState('');
  const [scopeId, setScopeId] = useState<string>(() => {
    if (defaultScopeId && writable.some((s) => s.id === defaultScopeId)) return defaultScopeId;
    return writable[0]?.id ?? '';
  });
  const [kind, setKind] = useState<MemoryKind>('explicit');
  const [sensitivity, setSensitivity] = useState<Sensitivity>('normal');
  const [confidence, setConfidence] = useState('1');
  const [tags, setTags] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = content.trim();
    if (!trimmed) {
      setError('Content is required');
      return;
    }
    const conf = Number(confidence);
    if (Number.isNaN(conf) || conf < 0 || conf > 1) {
      setError('Confidence must be a number between 0 and 1');
      return;
    }
    if (!scopeId) {
      setError('Pick a scope to store this memory in');
      return;
    }

    const body: CreateMemoryRequest = {
      content: trimmed,
      scopeId,
      kind,
      sensitivity,
      confidence: conf,
    };
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tagList.length > 0) body.tags = tagList;
    if (expiresAt) {
      const date = new Date(expiresAt);
      if (Number.isNaN(date.getTime())) {
        setError('Invalid expiry date');
        return;
      }
      body.expiresAt = date.toISOString();
    }

    setPending(true);
    try {
      const res = await api.createMemory(body);
      onCreated(res.memory);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Modal title="New memory" onClose={onClose} width={560}>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="mem-content">Content</label>
          <textarea
            id="mem-content"
            className="textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What should your AI tools remember?"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <label htmlFor="mem-scope">Scope</label>
          <select id="mem-scope" className="select" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
            <ScopeOptions scopes={writable} />
          </select>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="mem-kind">Kind</label>
            <select id="mem-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
              <option value="explicit">explicit</option>
              <option value="inferred">inferred</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="mem-sensitivity">Sensitivity</label>
            <select
              id="mem-sensitivity"
              className="select"
              value={sensitivity}
              onChange={(e) => setSensitivity(e.target.value as Sensitivity)}
            >
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="mem-confidence">Confidence (0–1)</label>
            <input
              id="mem-confidence"
              className="input"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="mem-expires">Expires (optional)</label>
            <input
              id="mem-expires"
              className="input"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="mem-tags">Tags</label>
          <input
            id="mem-tags"
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma, separated, tags"
          />
        </div>

        <div className="modal-footer" style={{ padding: '14px 0 0', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <Spinner size={13} />}
            Create memory
          </button>
        </div>
      </form>
    </Modal>
  );
}
