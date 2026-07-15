import { Fragment, useMemo, useState } from 'react';
import { ChevronDownIcon, KeyRoundIcon, ScrollTextIcon, SearchIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AuditEntry, AuditListResponse } from '@echo/shared';
import type { AuditQuery } from '../api';
import { useAudit } from '@/hooks';
import { SourceChip } from './Badge';
import { CopyButton } from './CodeBlock';
import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';
import { RequestErrorState } from './RequestErrorState';
import { AuditListSkeleton } from './Skeletons';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AUDIT_CATEGORIES, actionIcon, actionLabel, auditCategory, auditTileStyle, detailSummary } from '@/lib/audit';
import { useDebouncedValue } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

/** "Today" / "Yesterday" / "Wed, Jul 9" (with year once it differs). */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Paginated audit activity feed: entries grouped by day, one-line human
 * summaries, and a per-row expander with the full record. Filterable by
 * category chip or a free-text action-substring search (the two share the
 * single server-side `action` filter, so picking one clears the other).
 *
 * `fetchPage` points it at /audit or /orgs/:id/audit; `scopeKey`
 * distinguishes those sources in the SWR cache. `showActor` surfaces who
 * performed each action (useful in org logs where actors differ).
 */
export function AuditTable({
  fetchPage,
  scopeKey,
  categories = AUDIT_CATEGORIES.map((c) => c.key),
  showActor = false,
}: {
  fetchPage: (q: AuditQuery) => Promise<AuditListResponse>;
  scopeKey: string;
  /** Category-chip keys to offer; defaults to all of them. */
  categories?: string[];
  showActor?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState('all');
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Only the typed action filter is debounced; chips and pagination fetch immediately.
  const debouncedAction = useDebouncedValue(action);
  const chips = AUDIT_CATEGORIES.filter((c) => categories.includes(c.key));
  const activePrefix = chips.find((c) => c.key === category)?.prefix;
  const filter = debouncedAction.trim() || activePrefix || undefined;

  const { data, error, isLoading, isValidating, mutate } = useAudit(scopeKey, fetchPage, {
    limit: PAGE_SIZE,
    offset,
    action: filter,
  });
  const entries: AuditEntry[] | null = data?.entries ?? null;
  const total = data?.total ?? 0;
  const loading = isValidating;

  const groups = useMemo(() => {
    const out: { label: string; entries: AuditEntry[] }[] = [];
    for (const entry of entries ?? []) {
      const label = dayLabel(entry.occurredAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.entries.push(entry);
      else out.push({ label, entries: [entry] });
    }
    return out;
  }, [entries]);

  if (entries === null && !isLoading && error) {
    return <RequestErrorState error={error} onRetry={() => mutate()} />;
  }

  const filtered = Boolean(filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <Tabs
            value={category}
            onValueChange={(value) => {
              setCategory(value);
              setAction('');
              setOffset(0);
              setExpanded(null);
            }}
          >
            <TabsList>
              <TabsTrigger value="all" className="px-2.5">
                All
              </TabsTrigger>
              {chips.map((c) => (
                <TabsTrigger key={c.key} value={c.key} className="px-2.5">
                  {c.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="relative w-52 max-w-full">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setCategory('all');
              setOffset(0);
              setExpanded(null);
            }}
            placeholder="Filter by action, e.g. memory."
            aria-label="Filter by action"
            maxLength={64}
          />
        </div>
        {data && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {total} {total === 1 ? 'event' : 'events'}
          </span>
        )}
      </div>

      {entries === null ? (
        <AuditListSkeleton />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<ScrollTextIcon />}
          title={filtered ? 'No matching events' : 'No activity yet'}
          description={
            filtered
              ? 'No audit events match the current filter.'
              : 'Actions taken by you and your API keys will be recorded here.'
          }
        />
      ) : (
        <>
          <div className={cn('divide-y overflow-hidden rounded-xl border bg-card shadow-card', loading && 'opacity-55')}>
            {groups.map((group) => (
              <section key={group.label}>
                <header className="flex items-baseline gap-2 border-b bg-muted/40 px-4 py-1.5">
                  <h3 className="text-xs font-medium">{group.label}</h3>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {group.entries.length} {group.entries.length === 1 ? 'event' : 'events'}
                  </span>
                </header>
                <ul className="divide-y">
                  {group.entries.map((entry) => (
                    <AuditRow
                      key={entry.id}
                      entry={entry}
                      isOpen={expanded === entry.id}
                      showActor={showActor}
                      onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            total={total}
            onChange={(next) => {
              setOffset(next);
              setExpanded(null);
            }}
          />
        </>
      )}
    </div>
  );
}

function AuditRow({
  entry,
  isOpen,
  showActor,
  onToggle,
}: {
  entry: AuditEntry;
  isOpen: boolean;
  showActor: boolean;
  onToggle: () => void;
}) {
  const category = auditCategory(entry.action);
  const Icon = actionIcon(entry.action);
  const summary = detailSummary(entry);

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={auditTileStyle(category)}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13px]/5 font-medium">{actionLabel(entry.action)}</span>
            {showActor && entry.actorName && (
              <span className="truncate text-[11px] text-muted-foreground">by {entry.actorName}</span>
            )}
          </span>
          {summary && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>}
        </span>
        {entry.apiKeyName && (
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground max-md:hidden">
            <KeyRoundIcon className="size-3 shrink-0" />
            <span className="max-w-32 truncate">{entry.apiKeyName}</span>
          </span>
        )}
        <SourceChip app={entry.sourceApp} className="max-sm:hidden" />
        <time
          dateTime={entry.occurredAt}
          title={new Date(entry.occurredAt).toLocaleString()}
          className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
        >
          {clockTime(entry.occurredAt)}
        </time>
        <ChevronDownIcon
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen && <AuditRowDetails entry={entry} />}
    </li>
  );
}

/** Value cell for one details entry — scalars inline, nested structures as JSON. */
function DetailValue({ value }: { value: unknown }) {
  if (value !== null && typeof value === 'object') {
    return (
      <pre className="whitespace-pre-wrap rounded-md border bg-background px-2 py-1.5 font-mono text-[11px]/relaxed text-muted-foreground [overflow-wrap:anywhere] dark:bg-input/10">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="font-mono [overflow-wrap:anywhere]">{String(value)}</span>;
}

/**
 * Expanded record: full timestamp, actor, key and source, the raw action
 * code, linked/copyable ids, and every details field.
 */
function AuditRowDetails({ entry }: { entry: AuditEntry }) {
  const references: { label: string; id: string; to?: string }[] = [];
  if (entry.memoryId) {
    references.push({
      label: 'Memory',
      id: entry.memoryId,
      // Deleted memories have no detail page to link to.
      to: entry.action === 'memory.delete' ? undefined : `/memories/${entry.memoryId}`,
    });
  }
  if (entry.scopeId) references.push({ label: 'Scope', id: entry.scopeId });
  if (entry.orgId) references.push({ label: 'Org', id: entry.orgId });
  const details = Object.entries(entry.details);

  return (
    <div className="space-y-3 border-t bg-muted/20 px-4 py-3 sm:pl-14">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="rounded-md font-mono">
          {entry.action}
        </Badge>
        <span>{new Date(entry.occurredAt).toLocaleString()}</span>
        {entry.actorName && <span>by {entry.actorName}</span>}
        {entry.apiKeyName && <span>via key “{entry.apiKeyName}”</span>}
        <SourceChip app={entry.sourceApp} />
      </div>
      {(references.length > 0 || details.length > 0) && (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-1 text-xs">
          {references.map((ref) => (
            <Fragment key={ref.label}>
              <dt className="text-muted-foreground">{ref.label}</dt>
              <dd className="flex min-w-0 items-center gap-0.5">
                {ref.to ? (
                  <Link to={ref.to} className="truncate font-mono underline-offset-2 hover:underline">
                    {ref.id}
                  </Link>
                ) : (
                  <span className="truncate font-mono">{ref.id}</span>
                )}
                <CopyButton text={ref.id} label={`Copy ${ref.label.toLowerCase()} id`} />
              </dd>
            </Fragment>
          ))}
          {details.map(([key, value]) => (
            <Fragment key={key}>
              <dt className="self-start py-px text-muted-foreground">{key}</dt>
              <dd className="min-w-0">
                <DetailValue value={value} />
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}
