export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;

  const diffMs = Date.now() - then;
  const future = diffMs < 0;
  const s = Math.floor(Math.abs(diffMs) / 1000);

  let label: string;
  if (s < 45) label = future ? 'moments' : 'just now';
  else if (s < 90) label = '1m';
  else if (s < 3600) label = `${Math.floor(s / 60)}m`;
  else if (s < 86400) label = `${Math.floor(s / 3600)}h`;
  else if (s < 86400 * 30) label = `${Math.floor(s / 86400)}d`;
  else if (s < 86400 * 365) label = `${Math.floor(s / (86400 * 30))}mo`;
  else label = `${Math.floor(s / (86400 * 365))}y`;

  if (!future) return label === 'just now' ? label : `${label} ago`;
  return `in ${label}`;
}

/** "2h ago" with the full timestamp in a tooltip. */
export function RelativeTime({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={date} title={new Date(date).toLocaleString()}>
      {formatRelative(date)}
    </time>
  );
}
