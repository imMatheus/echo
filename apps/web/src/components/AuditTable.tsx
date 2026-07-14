import { useState } from 'react';
import { ChevronRightIcon, ScrollTextIcon } from 'lucide-react';
import type { AuditEntry, AuditListResponse } from '@echo/shared';
import type { AuditQuery } from '../api';
import { useAudit } from '@/hooks';
import { SourceChip } from './Badge';
import { EmptyState } from './EmptyState';
import { PageLoading } from './PageLoading';
import { Pagination } from './Pagination';
import { RelativeTime } from './RelativeTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebouncedValue } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

function DetailsRow({ entry }: { entry: AuditEntry }) {
  const details: Record<string, unknown> = { ...entry.details };
  if (entry.memoryId) details.memoryId = entry.memoryId;
  if (entry.scopeId) details.scopeId = entry.scopeId;
  if (entry.orgId) details.orgId = entry.orgId;
  return (
    <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
      {JSON.stringify(details, null, 2)}
    </pre>
  );
}

/**
 * Paginated audit table with an action-substring filter and per-row details
 * expander. `fetchPage` points it at /audit or /orgs/:id/audit; `scopeKey`
 * distinguishes those sources in the SWR cache.
 */
export function AuditTable({
  fetchPage,
  scopeKey,
}: {
  fetchPage: (q: AuditQuery) => Promise<AuditListResponse>;
  scopeKey: string;
}) {
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Only the typed action filter is debounced; pagination fetches immediately.
  const debouncedAction = useDebouncedValue(action);

  const { data, isLoading, isValidating } = useAudit(scopeKey, fetchPage, {
    limit: PAGE_SIZE,
    offset,
    action: debouncedAction.trim() || undefined,
  });
  const entries: AuditEntry[] | null = data?.entries ?? null;
  const total = data?.total ?? 0;
  const loading = isValidating;

  if (entries === null && isLoading) return <PageLoading />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="w-60"
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
          icon={<ScrollTextIcon />}
          title={action ? 'No matching events' : 'No activity yet'}
          description={
            action
              ? 'No audit events match that action filter.'
              : 'Actions taken by you and your API keys will be recorded here.'
          }
        />
      ) : (
        <>
          <div className={cn('overflow-x-auto rounded-xl border bg-card', loading && 'opacity-55')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-22">Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>API key</TableHead>
                  <TableHead className="w-22">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
              </TableBody>
            </Table>
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
      <TableRow>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          <RelativeTime date={entry.occurredAt} />
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="rounded-md font-mono">
            {entry.action}
          </Badge>
        </TableCell>
        <TableCell>
          <SourceChip app={entry.sourceApp} />
        </TableCell>
        <TableCell className="text-muted-foreground">{entry.apiKeyName ?? '—'}</TableCell>
        <TableCell>
          {hasDetails ? (
            <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={isOpen}>
              <ChevronRightIcon className={cn('transition-transform', isOpen && 'rotate-90')} />
              {isOpen ? 'Hide' : 'Show'}
            </Button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="bg-background px-4 py-3">
            <DetailsRow entry={entry} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
