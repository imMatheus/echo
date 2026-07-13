import { useEffect, useState } from 'react';
import type { AuditEntry, AuditListResponse } from '@echo/shared';
import type { AuditQuery } from '../api';
import { errorMessage } from '../api';
import { SourceChip } from './Badge';
import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';
import { RelativeTime } from './RelativeTime';
import { PageLoading } from './Spinner';
import { useToast } from './Toast';
import { EmptyAuditIcon } from './icons';

const PAGE_SIZE = 50;

function DetailsRow({ entry }: { entry: AuditEntry }) {
  const details: Record<string, unknown> = { ...entry.details };
  if (entry.memoryId) details.memoryId = entry.memoryId;
  if (entry.scopeId) details.scopeId = entry.scopeId;
  if (entry.orgId) details.orgId = entry.orgId;
  return <pre className="details-json">{JSON.stringify(details, null, 2)}</pre>;
}

/**
 * Paginated audit table with an action-substring filter and per-row details
 * expander. `fetchPage` points it at /audit or /orgs/:id/audit.
 */
export function AuditTable({
  fetchPage,
}: {
  fetchPage: (q: AuditQuery) => Promise<AuditListResponse>;
}) {
  const toast = useToast();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchPage({ limit: PAGE_SIZE, offset, action: action.trim() || undefined })
        .then((res) => {
          if (cancelled) return;
          setEntries(res.entries);
          setTotal(res.total);
        })
        .catch((err) => {
          if (!cancelled) toast.error(errorMessage(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchPage, offset, action, toast]);

  if (entries === null && loading) return <PageLoading />;

  return (
    <div>
      <div className="filters-row">
        <input
          className="input"
          style={{ minWidth: 220 }}
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0);
          }}
          placeholder="Filter by action, e.g. memory."
          aria-label="Filter by action"
        />
      </div>

      {entries && entries.length === 0 ? (
        <EmptyState
          icon={<EmptyAuditIcon />}
          title={action ? 'No matching events' : 'No activity yet'}
          description={
            action
              ? 'No audit events match that action filter.'
              : 'Actions taken by you and your API keys will be recorded here.'
          }
        />
      ) : (
        <>
          <div className="table-wrap" style={loading ? { opacity: 0.55 } : undefined}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Time</th>
                  <th>Action</th>
                  <th>Source</th>
                  <th>API key</th>
                  <th style={{ width: 90 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {(entries ?? []).map((entry) => {
                  const isOpen = expanded === entry.id;
                  const hasDetails =
                    Object.keys(entry.details).length > 0 ||
                    entry.memoryId !== null ||
                    entry.scopeId !== null ||
                    entry.orgId !== null;
                  return (
                    <FragmentRow
                      key={entry.id}
                      entry={entry}
                      isOpen={isOpen}
                      hasDetails={hasDetails}
                      onToggle={() => setExpanded(isOpen ? null : entry.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={total} onChange={setOffset} />
        </>
      )}
    </div>
  );
}

function FragmentRow({
  entry,
  isOpen,
  hasDetails,
  onToggle,
}: {
  entry: AuditEntry;
  isOpen: boolean;
  hasDetails: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td className="muted" style={{ whiteSpace: 'nowrap' }}>
          <RelativeTime date={entry.occurredAt} />
        </td>
        <td>
          <span className="chip-mono" style={{ color: 'var(--text)' }}>
            {entry.action}
          </span>
        </td>
        <td>
          <SourceChip app={entry.sourceApp} />
        </td>
        <td className="muted">{entry.apiKeyName ?? '—'}</td>
        <td>
          {hasDetails ? (
            <button type="button" className="expander" onClick={onToggle} aria-expanded={isOpen}>
              <span className={`arrow${isOpen ? ' open' : ''}`}>▸</span>
              {isOpen ? 'Hide' : 'Show'}
            </button>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={5} className="expanded-cell">
            <DetailsRow entry={entry} />
          </td>
        </tr>
      )}
    </>
  );
}
