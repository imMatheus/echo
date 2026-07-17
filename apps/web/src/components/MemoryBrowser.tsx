import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LayersIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import type { Memory, MemoryKind, ScopeWithAccess } from '@echo/shared';
import { MEMORY_KINDS } from '@echo/shared';
import { ApiRequestError } from '@/api';
import { useMemories, useMemorySearch, useRevalidateMemories } from '@/hooks';
import { KindBadge, ScopeBadge, SensitivityBadge, SourceChip, Tag } from './Badge';
import { EmptyState } from './EmptyState';
import { MemoryFormModal } from './MemoryFormModal';
import { PageHeader } from './PageHeader';
import { Pagination } from './Pagination';
import { RelativeTime } from './RelativeTime';
import { RequestErrorState } from './RequestErrorState';
import { ScopeSelectItems, scopeSelectItems } from './ScopeOptions';
import { MemoryGridSkeleton } from './Skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebouncedValue } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';

// Divisible by both 2 and 3 so full pages always fill complete grid rows.
const PAGE_SIZE = 24;

/** Responsive card grid: 1 column on phones, 2 on tablets, 3 on large screens. */
const CARD_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3';

const KIND_ITEMS = [{ value: 'all', label: 'All kinds' }, ...MEMORY_KINDS.map((k) => ({ value: k, label: k }))];

export function MemoryCard({ memory, scorePill }: { memory: Memory; scorePill?: ReactNode }) {
  const location = useLocation();
  return (
    <Link
      to={`/memories/${memory.id}`}
      // Carry the current page as `background` so the detail opens as a modal
      // over this list; a direct visit to the URL renders the full page.
      state={{ background: location }}
      // Shares the dqnamo card anatomy with PreviewCard: a p-1 shell around an
      // inset well (the memory's badges + content), with the tags/source footer
      // tucked below. Shell and well each shift one grayscale step on hover.
      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[13px] border border-grayscale-3 bg-grayscale-1 p-1 shadow-card transition-colors hover:border-grayscale-4 hover:bg-grayscale-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:border-grayscale-4 dark:bg-grayscale-3 dark:shadow-none dark:hover:border-grayscale-6 dark:hover:bg-grayscale-4"
    >
      <div className="flex flex-1 flex-col gap-2 rounded-lg bg-grayscale-2 p-3 transition-colors group-hover:bg-grayscale-3 dark:bg-grayscale-2 dark:group-hover:bg-grayscale-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {scorePill}
          <ScopeBadge type={memory.scopeType} name={memory.scopeName} />
          <KindBadge kind={memory.kind} />
          <SensitivityBadge sensitivity={memory.sensitivity} />
          <span className="ms-auto whitespace-nowrap ps-1">
            <RelativeTime date={memory.createdAt} />
          </span>
        </div>
        <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
          {memory.content}
        </p>
      </div>
      <div className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5 px-2 pt-2.5 pb-1.5">
        {memory.tags.map((t) => (
          <Tag key={t} tag={t} />
        ))}
        <SourceChip app={memory.sourceApp} />
      </div>
    </Link>
  );
}

/**
 * Browse + semantic-search UI over memories. Used by the main Memories page
 * (all readable scopes) and by the org detail Memories tab (org scopes only).
 */
export function MemoryBrowser({
  scopes,
  heading,
  subheading,
  allowAllScopes = true,
  defaultScopeId,
}: {
  /** Scope filter options (already restricted for the org view). */
  scopes: ScopeWithAccess[];
  /** When set, renders an h1 header row with the memory count. */
  heading?: string;
  /** Subtitle under the heading; only rendered when `heading` is set. */
  subheading?: string;
  /** Include an "All scopes" option in the filter (personal view only). */
  allowAllScopes?: boolean;
  defaultScopeId?: string;
}) {
  // "all" is a sentinel — the API treats missing scopeId as "all readable scopes"
  const initialScope = allowAllScopes ? 'all' : (defaultScopeId ?? scopes[0]?.id ?? '');
  const [scopeId, setScopeId] = useState(initialScope);
  const [kind, setKind] = useState('all');
  const [sourceApp, setSourceApp] = useState('');
  const [tag, setTag] = useState('');
  const [offset, setOffset] = useState(0);

  const [searchInput, setSearchInput] = useState('');
  // The active search request; null while browsing. Setting it drives the
  // useMemorySearch SWR key below.
  const [searchReq, setSearchReq] = useState<{ query: string; scope: string } | null>(null);

  const [showCreate, setShowCreate] = useState(false);

  const revalidateMemories = useRevalidateMemories();

  const accessibleScopeIds = useMemo(() => new Set(scopes.map((scope) => scope.id)), [scopes]);
  const scopeIdSignature = useMemo(() => [...accessibleScopeIds].sort().join('|'), [accessibleScopeIds]);
  const previousScopeIdSignature = useRef(scopeIdSignature);

  const scopeItems = scopeSelectItems(scopes, allowAllScopes ? [{ value: 'all', label: 'All scopes' }] : undefined);

  // Only the free-text filters are debounced; scope/kind/pagination fetch immediately.
  const debouncedSourceApp = useDebouncedValue(sourceApp);
  const debouncedTag = useDebouncedValue(tag);
  const debouncedSearchInput = useDebouncedValue(searchInput);

  const {
    data: listData,
    error: listError,
    isLoading,
    isValidating,
    mutate: mutateList,
  } = useMemories({
    scopeId: scopeId === 'all' ? undefined : scopeId || undefined,
    kind: (kind === 'all' ? undefined : kind) as MemoryKind | undefined,
    sourceApp: debouncedSourceApp.trim() || undefined,
    tag: debouncedTag.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const memories: Memory[] | null = useMemo(
    () => listData?.memories.filter((memory) => accessibleScopeIds.has(memory.scopeId)) ?? null,
    [accessibleScopeIds, listData],
  );
  const discardedListResults = Boolean(listData && memories && memories.length !== listData.memories.length);
  // Do not retain a total that can reveal how many now-inaccessible rows were
  // present in the cached page while its fresh request is in flight.
  const total = discardedListResults ? (memories?.length ?? 0) : (listData?.total ?? 0);

  const {
    data: searchData,
    error: searchError,
    isValidating: searching,
    mutate: mutateSearch,
  } = useMemorySearch(searchReq?.query ?? null, searchReq?.scope ?? scopeId);
  // Only treat search as active when the user has submitted one; clearing the
  // request must also hide any cached result for an earlier identical query.
  const search = useMemo(() => {
    if (!searchReq || !searchData) return null;
    const results = searchData.results.filter((memory) => accessibleScopeIds.has(memory.scopeId));
    return results.length === searchData.results.length ? searchData : { ...searchData, results };
  }, [accessibleScopeIds, searchData, searchReq]);

  useEffect(() => {
    const previous = previousScopeIdSignature.current;
    previousScopeIdSignature.current = scopeIdSignature;
    if (previous === scopeIdSignature) return;

    // A membership change invalidates both the selected scope and the ranking
    // of an all-scopes search. Clear the active request; useScopes also evicts
    // every cached search key so resubmitting cannot flash old results.
    setSearchReq(null);
    setOffset(0);

    if (scopeId !== 'all' && !accessibleScopeIds.has(scopeId)) {
      const fallback = allowAllScopes
        ? 'all'
        : defaultScopeId && accessibleScopeIds.has(defaultScopeId)
          ? defaultScopeId
          : (scopes[0]?.id ?? '');
      setScopeId(fallback);
    }
  }, [accessibleScopeIds, allowAllScopes, defaultScopeId, scopeId, scopeIdSignature, scopes]);

  const setFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setOffset(0);
    // kind/source/tag filters only apply to browsing — leave any active search
    // when they change so the list reflects the new filters.
    setSearchReq(null);
  };

  const onScopeChange = (value: string) => {
    setScopeId(value);
    setOffset(0);
    // re-run any active search against the new scope selection
    setSearchReq((prev) => (prev ? { ...prev, scope: value } : prev));
  };

  useEffect(() => {
    const query = debouncedSearchInput.trim();
    setSearchReq((previous) => {
      if (!query) return null;
      if (previous?.query === query && previous.scope === scopeId) return previous;
      return { query, scope: scopeId };
    });
  }, [debouncedSearchInput, scopeId]);

  const clearSearch = () => {
    setSearchReq(null);
    setSearchInput('');
  };

  const hasFilters =
    kind !== 'all' || sourceApp.trim() !== '' || tag.trim() !== '' || (allowAllScopes && scopeId !== 'all');

  const clearFilters = () => {
    if (allowAllScopes) setScopeId('all');
    setKind('all');
    setSourceApp('');
    setTag('');
    setOffset(0);
  };

  const onCreated = () => {
    setShowCreate(false);
    toast.success('Memory created');
    setSearchReq(null);
    setOffset(0);
    revalidateMemories();
  };

  const newMemoryButton = (
    <Button onClick={() => setShowCreate(true)}>
      <PlusIcon data-icon="inline-start" />
      New memory
    </Button>
  );

  // SWR intentionally retains usable data across transient failures. A 403 or
  // 404 is different: it can mean access was revoked, so cached rows must not
  // remain visible while the scope refresh/reset completes.
  const listAccessLost = listError instanceof ApiRequestError && (listError.status === 403 || listError.status === 404);
  const searchAccessLost =
    searchError instanceof ApiRequestError && (searchError.status === 403 || searchError.status === 404);
  const displayedListError = !searchReq && listError && (!listData || listAccessLost) ? listError : null;
  const displayedSearchError = searchReq && searchError && (!searchData || searchAccessLost) ? searchError : null;

  return (
    <div>
      {heading && (
        <PageHeader
          title={heading}
          titleExtra={<Badge variant="secondary">{search ? search.results.length : total}</Badge>}
          subtitle={subheading}
          actions={newMemoryButton}
        />
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-40 flex-[1_1_16rem]">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search memories semantically…"
            aria-label="Search memories"
            aria-busy={searching}
            maxLength={1_000}
          />
        </div>
        {!heading && newMemoryButton}
      </div>

      {displayedSearchError ? (
        <RequestErrorState error={displayedSearchError} onRetry={() => mutateSearch()} title="Search failed" />
      ) : displayedListError ? (
        <RequestErrorState error={displayedListError} onRetry={() => mutateList()} />
      ) : search ? (
        <div className="mb-4 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
          <span>
            {search.results.length} result{search.results.length === 1 ? '' : 's'} for “{search.query}”
          </span>
          <Badge
            variant="outline"
            className="font-mono"
            title={search.mode === 'hybrid' ? 'Semantic + full-text search' : 'Full-text search only'}
          >
            {search.mode === 'hybrid' ? 'hybrid' : 'full-text'}
          </Badge>
          <Button variant="ghost" size="sm" onClick={clearSearch}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2">
          <Select items={scopeItems} value={scopeId} onValueChange={(v) => onScopeChange(v as string)}>
            <SelectTrigger className="w-48 max-w-full" aria-label="Filter by scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowAllScopes && <SelectItem value="all">All scopes</SelectItem>}
              <ScopeSelectItems scopes={scopes} />
            </SelectContent>
          </Select>
          <Select items={KIND_ITEMS} value={kind} onValueChange={(v) => setFilter(setKind)(v as string)}>
            <SelectTrigger className="w-32 max-w-full" aria-label="Filter by kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-32 max-w-full"
            value={sourceApp}
            onChange={(e) => setFilter(setSourceApp)(e.target.value)}
            placeholder="Source app"
            aria-label="Filter by source app"
            maxLength={64}
          />
          <Input
            className="w-32 max-w-full"
            value={tag}
            onChange={(e) => setFilter(setTag)(e.target.value)}
            placeholder="Tag"
            aria-label="Filter by tag"
            maxLength={64}
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Reset filters
            </Button>
          )}
        </div>
      )}

      {displayedSearchError || displayedListError ? null : search ? (
        search.results.length === 0 ? (
          <EmptyState
            icon={<LayersIcon />}
            title="No results"
            description={`Nothing matched “${search.query}”. Try different phrasing — semantic search matches meaning, not just keywords.`}
            action={
              <Button variant="outline" onClick={clearSearch}>
                Clear search
              </Button>
            }
          />
        ) : (
          <div className={CARD_GRID}>
            {search.results.map((result, i) => (
              <MemoryCard
                key={result.id}
                memory={result}
                scorePill={
                  <Badge
                    className="border-success/35 bg-success/10 text-success"
                    title={`score ${result.score.toFixed(4)}`}
                  >
                    {result.similarity != null ? `${Math.round(result.similarity * 100)}% match` : `match #${i + 1}`}
                  </Badge>
                }
              />
            ))}
          </div>
        )
      ) : isLoading && memories === null ? (
        <MemoryGridSkeleton />
      ) : memories && memories.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<LayersIcon />}
            title="No memories match your filters"
            description="Try removing some filters, or create a memory in this scope."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<LayersIcon />}
            title="No memories yet"
            description="Memories written by you or your AI tools will show up here. Create one to get started."
            action={
              <Button onClick={() => setShowCreate(true)}>
                <PlusIcon data-icon="inline-start" />
                New memory
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className={cn(CARD_GRID, isValidating && 'opacity-55')}>
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
          defaultScopeId={(scopeId !== 'all' && scopeId) || defaultScopeId}
          onClose={() => setShowCreate(false)}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
