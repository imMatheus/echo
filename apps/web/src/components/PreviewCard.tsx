import type { ReactNode } from 'react';
import { ArrowRightIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * dqnamo experiment-card anatomy: a p-1 shell wrapping an inset "preview well",
 * with a title/description block tucked below. The hover treatment — shell and
 * well each shift one grayscale step, plus a nudging arrow — is gated behind
 * `interactive`, so only cards that actually navigate somewhere react to the
 * pointer. Pass `to` to render the card as a router link (which turns it
 * interactive); omit it for display-only cards like dashboard stat tiles.
 */
export function PreviewCard({
  preview,
  title,
  description,
  badge,
  to,
  interactive: interactiveProp,
  className,
}: {
  /** Content for the tinted inset well — a stat, monogram, thumbnail, etc. */
  preview: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Optional chip pinned to the top-right corner of the well (e.g. a status badge). */
  badge?: ReactNode;
  /** When set, the card renders as a router link and becomes interactive. */
  to?: string;
  /** Force the hover treatment. Defaults to true when `to` is set, else false. */
  interactive?: boolean;
  className?: string;
}) {
  const interactive = interactiveProp ?? to != null;

  const rootClassName = cn(
    'group flex flex-col overflow-hidden rounded-[13px] border border-grayscale-3 bg-grayscale-1 p-1 shadow-card transition-colors dark:border-grayscale-4 dark:bg-grayscale-3 dark:shadow-none',
    interactive &&
      'hover:border-grayscale-4 hover:bg-grayscale-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:hover:border-grayscale-6 dark:hover:bg-grayscale-4',
    className,
  );

  const content = (
    <>
      <div
        className={cn(
          'relative flex h-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-grayscale-2 transition-colors dark:bg-grayscale-2',
          interactive && 'group-hover:bg-grayscale-3 dark:group-hover:bg-grayscale-3',
        )}
      >
        {badge && <div className="absolute top-2 right-2">{badge}</div>}
        {preview}
      </div>
      <div className="mt-auto flex flex-col px-2 pt-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-medium text-grayscale-12 [overflow-wrap:anywhere]">{title}</h3>
          {interactive && (
            <ArrowRightIcon className="mt-0.5 size-3.5 shrink-0 text-grayscale-9 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-grayscale-11" />
          )}
        </div>
        {description && (
          <div className="mt-1 text-pretty text-xs leading-5 text-grayscale-10">{description}</div>
        )}
      </div>
    </>
  );

  if (to != null) {
    return (
      <Link to={to} className={rootClassName}>
        {content}
      </Link>
    );
  }
  return <div className={rootClassName}>{content}</div>;
}
