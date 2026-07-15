import { Button } from '@/components/ui/button';

const MAX_API_OFFSET = 100_000;

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit && offset === 0) return null;

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const nextOffset = offset + limit;
  const offsetLimitReached = nextOffset > MAX_API_OFFSET && nextOffset < total;

  return (
    <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2.5 text-xs text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      {offsetLimitReached && <span title="The API caps offsets at 100,000">Pagination limit reached</span>}
      <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={nextOffset >= total || nextOffset > MAX_API_OFFSET}
        onClick={() => onChange(nextOffset)}
      >
        Next
      </Button>
    </div>
  );
}
