import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Shared skeleton loaders. Each mirrors the anatomy (shell, padding, row
 * heights) of the component it stands in for, so the layout doesn't shift
 * when real data lands. Bars sit centered inside fixed-height "line boxes"
 * matching the real text's line-height (via <Line>), so stacked lines add up
 * to the height of the text block they replace. All are decorative: mark the
 * region loading with aria-busy at the call site if screen-reader feedback
 * matters.
 */

/** A skeleton bar vertically centered in a line box of the real text's line-height. */
function Line({ box, bar }: { box: string; bar: string }) {
  return (
    <div className={cn('flex items-center', box)}>
      <Skeleton className={bar} />
    </div>
  );
}

/**
 * Mirrors MemoryCard's p-1 shell + inset well + tag footer, sized for a
 * three-line memory (content is text-sm/relaxed → 22.75px lines; badges and
 * tags are h-5).
 */
function MemoryCardSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-[13px] border border-grayscale-3 bg-grayscale-1 p-1 shadow-card dark:border-grayscale-4 dark:bg-grayscale-3 dark:shadow-none">
      <div className="flex flex-1 flex-col gap-2 rounded-lg bg-grayscale-2 p-3">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-12" />
          <Skeleton className="ms-auto h-3 w-14" />
        </div>
        <div>
          <Line box="h-[22.75px]" bar="h-3.5 w-full" />
          <Line box="h-[22.75px]" bar="h-3.5 w-11/12" />
          <Line box="h-[22.75px]" bar="h-3.5 w-3/5" />
        </div>
      </div>
      <div className="mt-auto flex items-center gap-1.5 px-2 pt-2.5 pb-1.5">
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-5 w-10" />
      </div>
    </div>
  );
}

/** Card grid matching MemoryBrowser's CARD_GRID breakpoints. */
export function MemoryGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <MemoryCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Stands in for MemoryBrowser's h-8 search box + h-7 scope/kind/source/tag filter row. */
export function MemoryFiltersSkeleton() {
  return (
    <div aria-hidden>
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-8 min-w-40 flex-[1_1_16rem]" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-32" />
      </div>
    </div>
  );
}

/**
 * Mirrors PreviewCard: p-1 shell, h-24 preview well, then a 20px title line
 * and a 20px description line (text-sm and text-xs/leading-5 both render
 * 20px line boxes).
 */
export function PreviewCardSkeleton() {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[13px] border border-grayscale-3 bg-grayscale-1 p-1 shadow-card dark:border-grayscale-4 dark:bg-grayscale-3 dark:shadow-none"
      aria-hidden
    >
      <Skeleton className="h-24 shrink-0 rounded-lg" />
      <div className="flex flex-col px-2 pt-3 pb-2">
        <Line box="h-5" bar="h-4 w-24" />
        <Line box="mt-1 h-5" bar="h-3 w-16" />
      </div>
    </div>
  );
}

/** Generic bordered data table: h-10 header row + 40px body rows. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border bg-card shadow-card dark:shadow-none"
      aria-hidden
    >
      <div className="flex h-10 items-center border-b px-4">
        <Skeleton className="h-3.5 w-40 max-w-full" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-44 max-sm:hidden" />
            <Skeleton className="h-4 w-16 max-md:hidden" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mirrors AuditTable's grouped feed: 29px day header + 58px rows (size-7
 * icon tile beside a 20px title line and a 16px summary line).
 */
export function AuditListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card" aria-hidden>
      <div className="border-b bg-muted/40 px-4 py-1.5">
        <Line box="h-4" bar="h-3 w-16" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <Skeleton className="size-7 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <Line box="h-5" bar="h-3.5 w-40 max-w-full" />
              <Line box="mt-0.5 h-4" bar="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-3 w-10 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A dashboard chart card (20px title line, 19.5px description line, plot
 * area) while stats load.
 */
export function ChartCardSkeleton({
  height = 'h-64',
  className,
}: {
  /** Tailwind height class for the plot area, matching the real chart. */
  height?: string;
  className?: string;
}) {
  return (
    <Card size="sm" className={className} aria-hidden>
      <CardHeader>
        <Line box="h-5" bar="h-3.5 w-40 max-w-full" />
        <Line box="h-[19.5px]" bar="h-3 w-64 max-w-full" />
      </CardHeader>
      <CardContent>
        <Skeleton className={cn('w-full', height)} />
      </CardContent>
    </Card>
  );
}
