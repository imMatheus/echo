import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Memory, MemoryKind, MemorySearchResult, ScopeWithAccess } from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { KindBadge, ScopeBadge, SensitivityBadge, SourceChip, Tag } from './Badge';
import { EmptyState } from './EmptyState';
import { MemoryFormModal } from './MemoryFormModal';
import { Pagination } from './Pagination';
import { RelativeTime } from './RelativeTime';
import { ScopeOptions } from './ScopeOptions';
import { PageLoading, Spinner } from './Spinner';
import { useToast } from './Toast';
import { EmptyMemoriesIcon, IconPlus, IconSearch } from './icons';

const PAGE_SIZE = 50;

export function MemoryCard({ memory, scorePill }: { memory: Memory; scorePill?: ReactNode }) {
  return (
    <Link to={`/memories/${memory.id}`} className="memory-card">
      <div className="memory-card-content">{memory.content}</div>
      <div className="memory-card-meta">
        {scorePill}
        <ScopeBadge type={memory.scopeType} name={memory.scopeName} />
        <KindBadge kind={memory.kind} />
        <SensitivityBadge sensitivity={memory.sensitivity} />
        {memory.tags.map((t) => (
          <Tag key={t} tag={t} />
        ))}
        <SourceChip app={memory.sourceApp} />
        <span className="spacer" />
        <RelativeTime date={memory.createdAt} />
      </div>
    </Link>
  );
}

interface ActiveSearch {
  query: string;
  results: MemorySearchResult[];
  mode: 'hybrid' | 'fts';
}

/**
 * Browse + semantic-search UI over memories. Used by the main Memories page
 * (all readable scopes) and by the org detail Memories tab (org scopes only).
 */
export function MemoryBrowser({
  scopes,
  heading,
  allowAllScopes = true,
  defaultScopeId,
}: {
  /** Scope filter options (already restricted for the org view). */
  scopes: ScopeWithAccess[];
  /** When set, renders an h1 header row with the memory count. */
  heading?: string;
  /** Include an "All scopes" option in the filter (personal view only). */
  allowAllScopes?: boolean;
  defaultScopeId?: string;
}) {
  const toast = useToast();

  const initialScope = allowAllScopes ? '' : (defaultScopeId ?? scopes[0]?.id ?? '');
  const [scopeId, setScopeId] = useState(initialScope);
  const [kind, setKind] = useState('');
  const [sourceApp, setSourceApp] = useState('');
  const [tag, setTag] = useState('');
  const [offset, setOffset] = useState(0);

  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<ActiveSearch | null>(null);
  const [searching, setSearching] = useState(false);

  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .listMemories({
          scopeId: scopeId || undefined,
          kind: (kind || undefined) as MemoryKind | undefined,
          sourceApp: sourceApp.trim() || undefined,
          tag: tag.trim() || undefined,
          limit: PAGE_SIZE,
          offset,
        })
        .then((res) => {
          if (cancelled) return;
          setMemories(res.memories);
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
  }, [scopeId, kind, sourceApp, tag, offset, refreshTick, toast]);

  const setFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setOffset(0);
    // kind/source/tag filters only apply to browsing — leave any active search
    // when they change so the list reflects the new filters.
    setSearch(null);
  };

  const onScopeChange = async (value: string) => {
    setScopeId(value);
    setOffset(0);
    if (search) {
      // re-run the active search against the new scope selection
      await runSearch(search.query, value);
    }
  };

  const runSearch = async (query: string, scope: string) => {
    setSearching(true);
    try {
      const res = await api.searchMemories({
        query,
        scopeIds: scope ? [scope] : undefined,
        limit: 50,
      });
      setSearch({ query, results: res.results, mode: res.mode });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  const onSearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const query = searchInput.trim();
    if (!query) {
      setSearch(null);
      return;
    }
    await runSearch(query, scopeId);
  };

  const clearSearch = () => {
    setSearch(null);
    setSearchInput('');
  };

  const hasFilters = kind !== '' || sourceApp.trim() !== '' || tag.trim() !== '' || (allowAllScopes && scopeId !== '');

  const clearFilters = () => {
    if (allowAllScopes) setScopeId('');
    setKind('');
    setSourceApp('');
    setTag('');
    setOffset(0);
  };

  const onCreated = () => {
    setShowCreate(false);
    toast.success('Memory created');
    setSearch(null);
    setOffset(0);
    setRefreshTick((t) => t + 1);
  };

  const newMemoryButton = (
    <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
      <IconPlus />
      New memory
    </button>
  );

  return (
    <div>
      {heading && (
        <div className="page-header">
          <h1>{heading}</h1>
          <span className="count-pill">{search ? search.results.length : total}</span>
          <span className="spacer" />
          {newMemoryButton}
        </div>
      )}

      <form className="search-form" onSubmit={(e) => void onSearchSubmit(e)}>
        <div className="search-input-wrap">
          <span className="search-icon">
            <IconSearch />
          </span>
          <input
            className="input search-input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search memories semantically… (press Enter)"
            aria-label="Search memories"
          />
        </div>
        <button type="submit" className="btn" disabled={searching}>
          {searching ? <Spinner size={13} /> : 'Search'}
        </button>
        {!heading && <span className="spacer" />}
        {!heading && newMemoryButton}
      </form>

      {search ? (
        <div className="search-status">
          <span>
            {search.results.length} result{search.results.length === 1 ? '' : 's'} for “{search.query}”
          </span>
          <span className="mode-hint" title={search.mode === 'hybrid' ? 'Semantic + full-text search' : 'Full-text search only'}>
            {search.mode === 'hybrid' ? 'hybrid' : 'full-text'}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearSearch}>
            Clear search
          </button>
        </div>
      ) : (
        <div className="filters-row">
          <select
            className="select filter-scope"
            value={scopeId}
            onChange={(e) => void onScopeChange(e.target.value)}
            aria-label="Filter by scope"
          >
            {allowAllScopes && <option value="">All scopes</option>}
            <ScopeOptions scopes={scopes} />
          </select>
          <select className="select" value={kind} onChange={(e) => setFilter(setKind)(e.target.value)} aria-label="Filter by kind">
            <option value="">All kinds</option>
            <option value="explicit">explicit</option>
            <option value="inferred">inferred</option>
          </select>
          <input
            className="input"
            value={sourceApp}
            onChange={(e) => setFilter(setSourceApp)(e.target.value)}
            placeholder="Source app"
            aria-label="Filter by source app"
          />
          <input
            className="input"
            value={tag}
            onChange={(e) => setFilter(setTag)(e.target.value)}
            placeholder="Tag"
            aria-label="Filter by tag"
          />
        </div>
      )}

      {search ? (
        search.results.length === 0 ? (
          <EmptyState
            icon={<EmptyMemoriesIcon />}
            title="No results"
            description={`Nothing matched “${search.query}”. Try different phrasing — semantic search matches meaning, not just keywords.`}
            action={
              <button type="button" className="btn" onClick={clearSearch}>
                Clear search
              </button>
            }
          />
        ) : (
          <div className="memory-list">
            {search.results.map((result, i) => (
              <MemoryCard
                key={result.id}
                memory={result}
                scorePill={
                  <span className="score-pill" title={`score ${result.score.toFixed(4)}`}>
                    {result.similarity != null
                      ? `${Math.round(result.similarity * 100)}% match`
                      : `match #${i + 1}`}
                  </span>
                }
              />
            ))}
          </div>
        )
      ) : loading && memories === null ? (
        <PageLoading />
      ) : memories && memories.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<EmptyMemoriesIcon />}
            title="No memories match your filters"
            description="Try removing some filters, or create a memory in this scope."
            action={
              <button type="button" className="btn" onClick={clearFilters}>
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<EmptyMemoriesIcon />}
            title="No memories yet"
            description="Memories written by you or your AI tools will show up here. Create one to get started."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <IconPlus />
                New memory
              </button>
            }
          />
        )
      ) : (
        <>
          <div className="memory-list" style={loading ? { opacity: 0.55 } : undefined}>
            {(memories ?? []).map((m) => (
              <MemoryCard key={m.id} memory={m} />
            ))}
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={total} onChange={setOffset} />
        </>
      )}

      {showCreate && (
        <MemoryFormModal
          scopes={scopes}
          defaultScopeId={scopeId || defaultScopeId}
          onClose={() => setShowCreate(false)}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
