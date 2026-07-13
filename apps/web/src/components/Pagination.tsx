import { Button } from '@/components/ui/button';

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

  return (
    <div className="mt-3.5 flex items-center justify-end gap-2.5 text-xs text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Previous
      </Button>
      <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Next
      </Button>
    </div>
  );
}
