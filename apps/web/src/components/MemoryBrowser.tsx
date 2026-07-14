import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LayersIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { Memory, MemoryKind, ScopeWithAccess } from '@echo/shared';
import { MEMORY_KINDS } from '@echo/shared';
import { useMemories, useMemorySearch, useRevalidateMemories } from '@/hooks';
import { KindBadge, ScopeBadge, SensitivityBadge, SourceChip, Tag } from './Badge';
import { EmptyState } from './EmptyState';
import { MemoryFormModal } from './MemoryFormModal';
import { PageLoading } from './PageLoading';
import { Pagination } from './Pagination';
import { RelativeTime } from './RelativeTime';
import { ScopeSelectItems, scopeSelectItems } from './ScopeOptions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useDebouncedValue } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

const KIND_ITEMS = [
  { value: 'all', label: 'All kinds' },
  ...MEMORY_KINDS.map((k) => ({ value: k, label: k })),
];

export function MemoryCard({ memory, scorePill }: { memory: Memory; scorePill?: ReactNode }) {
  return (
    <Link
      to={`/memories/${memory.id}`}
      className="block rounded-xl border bg-card px-4 py-3.5 transition-colors hover:border-ring/40 hover:bg-input/10"
    >
      <div className="mb-2.5 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
        {memory.content}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {scorePill}
        <ScopeBadge type={memory.scopeType} name={memory.scopeName} />
        <KindBadge kind={memory.kind} />
        <SensitivityBadge sensitivity={memory.sensitivity} />
        {memory.tags.map((t) => (
          <Tag key={t} tag={t} />
        ))}
        <SourceChip app={memory.sourceApp} />
        <span className="flex-1" />
        <RelativeTime date={memory.createdAt} />
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

  const scopeItems = scopeSelectItems(
    scopes,
    allowAllScopes ? [{ value: 'all', label: 'All scopes' }] : undefined,
  );

  // Only the free-text filters are debounced; scope/kind/pagination fetch immediately.
  const debouncedSourceApp = useDebouncedValue(sourceApp);
  const debouncedTag = useDebouncedValue(tag);

  const { data: listData, isLoading, isValidating } = useMemories({
    scopeId: scopeId === 'all' ? undefined : scopeId || undefined,
    kind: (kind === 'all' ? undefined : kind) as MemoryKind | undefined,
    sourceApp: debouncedSourceApp.trim() || undefined,
    tag: debouncedTag.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const memories: Memory[] | null = listData?.memories ?? null;
  const total = listData?.total ?? 0;

  const { data: searchData, isValidating: searching } = useMemorySearch(
    searchReq?.query ?? null,
    searchReq?.scope ?? scopeId,
  );
  // Only treat search as active when the user has submitted one; keepPreviousData
  // can otherwise leave stale results in the cache after clearing.
  const search = searchReq ? (searchData ?? null) : null;

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

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const query = searchInput.trim();
    if (!query) {
      setSearchReq(null);
      return;
    }
    setSearchReq({ query, scope: scopeId });
  };

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

  return (
    <div>
      {heading && (
        <div className="mb-5 flex items-center gap-3">
          <h1 className="font-heading text-xl font-semibold tracking-tight">{heading}</h1>
          <Badge variant="secondary">{search ? search.results.length : total}</Badge>
          <span className="flex-1" />
          {newMemoryButton}
        </div>
      )}

      <form className="mb-3 flex gap-2" onSubmit={onSearchSubmit}>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search memories semantically… (press Enter)"
            aria-label="Search memories"
          />
        </div>
        <Button type="submit" variant="outline" className="h-8" disabled={searching}>
          {searching ? <Spinner /> : 'Search'}
        </Button>
        {!heading && <span className="flex-1" />}
        {!heading && newMemoryButton}
      </form>

      {search ? (
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
            <SelectTrigger className="w-48" aria-label="Filter by scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowAllScopes && <SelectItem value="all">All scopes</SelectItem>}
              <ScopeSelectItems scopes={scopes} />
            </SelectContent>
          </Select>
          <Select items={KIND_ITEMS} value={kind} onValueChange={(v) => setFilter(setKind)(v as string)}>
            <SelectTrigger className="w-32" aria-label="Filter by kind">
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
            className="w-32"
            value={sourceApp}
            onChange={(e) => setFilter(setSourceApp)(e.target.value)}
            placeholder="Source app"
            aria-label="Filter by source app"
          />
          <Input
            className="w-32"
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
          <div className="flex flex-col gap-2.5">
            {search.results.map((result, i) => (
              <MemoryCard
                key={result.id}
                memory={result}
                scorePill={
                  <Badge
                    className="border-success/35 bg-success/10 text-success"
                    title={`score ${result.score.toFixed(4)}`}
                  >
                    {result.similarity != null
                      ? `${Math.round(result.similarity * 100)}% match`
                      : `match #${i + 1}`}
                  </Badge>
                }
              />
            ))}
          </div>
        )
      ) : isLoading && memories === null ? (
        <PageLoading />
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
          <div className={cn('flex flex-col gap-2.5', isValidating && 'opacity-55')}>
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
