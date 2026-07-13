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
    <div className="pagination">
      <span>
        {from}–{to} of {total}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </button>
    </div>
  );
}
