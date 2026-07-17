import { useCallback, useMemo } from 'react';
import { ScrollTextIcon, ZapIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { STATS_RANGES } from '@echo/shared';
import type { StatsRange, UsageStats } from '@echo/shared';
import type { AuditQuery } from '../api';
import * as api from '../api';
import { SourceChip } from '../components/Badge';
import { ChartEmpty } from '../components/ChartEmpty';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { PreviewCard } from '../components/PreviewCard';
import { RelativeTime } from '../components/RelativeTime';
import { RequestErrorState } from '../components/RequestErrorState';
import { ChartCardSkeleton, PreviewCardSkeleton } from '../components/Skeletons';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAudit, useStats } from '@/hooks';
import { actionIcon, actionLabel, auditCategory, auditTileStyle } from '@/lib/audit';
import { CHART_COLORS, CHART_OTHER_COLOR } from '@/lib/chart-colors';
import { formatBucket, formatBucketLong, isStatsRange, timeAxisTicks } from '@/lib/stats';
import { cn } from '@/lib/utils';

const RANGE_HINTS: Record<StatsRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

/**
 * Max distinctly-colored series in the activity stack; the rest fold into
 * "Other". Bounded by the shared categorical palette, whose hues are all
 * CVD-distinguishable, so we can show its full width before folding.
 */
const MAX_ACTION_SERIES = CHART_COLORS.length;

const compact = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Recharts treats dots in dataKey as a path lookup, so series keys can't be raw actions. */
function seriesKey(action: string): string {
  return action.replace(/\W/g, '_');
}

function StatTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  // Stat tiles are read-only, so no `interactive` — the card stays inert.
  return (
    <PreviewCard
      title={label}
      description={hint}
      preview={
        <span className="text-3xl font-semibold tracking-tight text-grayscale-12 tabular-nums">
          {compact.format(value)}
        </span>
      }
    />
  );
}

function MemoriesChart({ stats }: { stats: UsageStats }) {
  const data = useMemo(() => {
    const byBucket = new Map(stats.memoriesOverTime.map((r) => [r.bucket, r.count]));
    // The final bucket is the current, still-accumulating period. Split it into
    // its own dashed series so the line reads as "not done yet" — `count` draws
    // the solid history, `countProjected` overlaps the last segment dashed.
    const lastIndex = stats.buckets.length - 1;
    return stats.buckets.map((bucket, i) => {
      const value = byBucket.get(bucket) ?? 0;
      return {
        bucket,
        count: i < lastIndex ? value : null,
        countProjected: i >= lastIndex - 1 ? value : null,
        // Full-range invisible series so the tooltip shows one clean value at
        // every bucket, including the in-progress one where `count` is null.
        countValue: value,
      };
    });
  }, [stats]);

  const config = {
    count: { label: 'Memories', color: CHART_COLORS[0] },
    countProjected: { label: 'Memories', color: CHART_COLORS[0] },
    countValue: { label: 'Memories', color: CHART_COLORS[0] },
  } satisfies ChartConfig;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Active memories added</CardTitle>
        <CardDescription>
          Memories added per {stats.granularity} that are still active across your scopes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <AreaChart data={data} margin={{ top: 4, left: 0, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="bucket"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              ticks={timeAxisTicks(stats)}
              tickFormatter={(value: string) => formatBucket(value, stats.granularity)}
            />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, p) => formatBucketLong(String(p[0]?.payload.bucket), stats.granularity)}
                />
              }
            />
            <Area
              dataKey="countValue"
              type="monotone"
              // Invisible line (zero width, no fill), but a real stroke color so
              // the tooltip renders its purple indicator swatch.
              stroke="var(--color-countValue)"
              strokeWidth={0}
              fill="none"
              activeDot={false}
              isAnimationActive={false}
            />
            <Area
              dataKey="count"
              type="monotone"
              stroke="var(--color-count)"
              strokeWidth={2}
              fill="var(--color-count)"
              fillOpacity={0.1}
              isAnimationActive={false}
              tooltipType="none"
            />
            <Area
              dataKey="countProjected"
              type="monotone"
              stroke="var(--color-count)"
              strokeWidth={2}
              strokeDasharray="4 4"
              fill="var(--color-count)"
              fillOpacity={0.1}
              connectNulls
              isAnimationActive={false}
              tooltipType="none"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function ActivityChart({ stats }: { stats: UsageStats }) {
  const { data, series, config } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of stats.actionsOverTime) {
      totals.set(row.action, (totals.get(row.action) ?? 0) + row.count);
    }
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ACTION_SERIES)
      .map(([action]) => action)
      // Colors are assigned by alphabetical position, so an action keeps its
      // color across ranges as long as the same actions rank in the top set.
      .sort();
    const hasOther = totals.size > top.length;

    const config: ChartConfig = {};
    top.forEach((action, i) => {
      config[seriesKey(action)] = {
        label: actionLabel(action),
        color: CHART_COLORS[i],
      };
    });
    if (hasOther) config.other = { label: 'Other', color: CHART_OTHER_COLOR };

    const byBucket = new Map<string, Record<string, number>>();
    for (const row of stats.actionsOverTime) {
      const key = top.includes(row.action) ? seriesKey(row.action) : 'other';
      const entry = byBucket.get(row.bucket) ?? {};
      entry[key] = (entry[key] ?? 0) + row.count;
      byBucket.set(row.bucket, entry);
    }
    const series = [...top.map(seriesKey), ...(hasOther ? ['other'] : [])];
    const data = stats.buckets.map((bucket) => ({
      bucket,
      ...Object.fromEntries(series.map((s) => [s, 0])),
      ...byBucket.get(bucket),
    }));
    return { data, series, config };
  }, [stats]);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Recorded activity</CardTitle>
        <CardDescription>
          Audit events per {stats.granularity}, by type — recalls, writes, authentication, and admin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {series.length === 0 ? (
          <ChartEmpty message="No activity in this period yet." />
        ) : (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <BarChart data={data} margin={{ top: 4, left: 0, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                ticks={timeAxisTicks(stats)}
                tickFormatter={(value: string) => formatBucket(value, stats.granularity)}
              />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => formatBucketLong(String(p[0]?.payload.bucket), stats.granularity)}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              {series.map((key) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="calls"
                  fill={`var(--color-${key})`}
                  // 1px card-colored stroke = the surface gap between stacked segments.
                  stroke="var(--card)"
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function SourceAppsChart({ stats }: { stats: UsageStats }) {
  const { data, max, total } = useMemo(() => {
    const data = stats.sourceApps.slice(0, 6);
    // sourceApps is sorted most-active first, so the first row is the max.
    const max = data.length ? data[0]!.count : 0;
    const total = stats.sourceApps.reduce((sum, r) => sum + r.count, 0);
    return { data, max, total };
  }, [stats]);

  const hasData = data.length > 0;

  return (
    <Card size="sm" className="gap-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>Activity by source app</CardTitle>
        {hasData && (
          // Column headers line up with the row number cells below: same w-16
          // widths, and header + content share the card's horizontal padding.
          <CardAction className="flex items-center text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            <span className="w-16 text-right">Share</span>
            <span className="w-16 text-right">Events</span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="pt-2">
        {!hasData ? (
          <ChartEmpty message="No activity in this period yet." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.map((row) => {
              const share = total > 0 ? Math.round((row.count / total) * 100) : 0;
              // Bar fills the label column, scaled to the busiest app.
              const width = max > 0 ? Math.max((row.count / max) * 100, 3) : 0;
              return (
                <li
                  key={row.sourceApp}
                  className="flex h-9 items-center"
                  title={`${row.sourceApp}: ${row.count} event${row.count === 1 ? '' : 's'} (${share}%)`}
                >
                  <div className="relative flex min-w-0 flex-1 items-center self-stretch">
                    <div
                      aria-hidden
                      className="absolute inset-y-0 left-0 rounded-md bg-foreground/[0.06]"
                      style={{ width: `${width}%` }}
                    />
                    <span className="relative z-10 min-w-0 truncate pr-2 pl-2.5 font-mono text-xs">
                      {row.sourceApp}
                    </span>
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{share}%</span>
                  <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {compact.format(row.count)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivity() {
  const fetchPage = useCallback((q: AuditQuery) => api.getAudit(q), []);
  const { data } = useAudit('home', fetchPage, { limit: 8, offset: 0 });
  const entries = data?.entries ?? [];

  return (
    <Card size="sm" className="gap-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>Recent activity</CardTitle>
        <CardAction>
          <Link to="/audit" className="text-xs text-muted-foreground hover:text-foreground">
            View all →
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-1">
        {!data ? (
          <ul aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex items-center gap-2.5 border-b py-1.5 last:border-0">
                <Skeleton className="size-6 shrink-0 rounded-md" />
                <Skeleton className="h-3.5 w-40 max-w-full" />
                <Skeleton className="ml-auto h-3 w-12 shrink-0" />
              </li>
            ))}
          </ul>
        ) : entries.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <ScrollTextIcon className="size-4" />
            No activity yet.
          </div>
        ) : (
          <ul>
            {entries.map((entry) => {
              const Icon = actionIcon(entry.action);
              return (
                <li key={entry.id} className="flex items-center gap-2.5 border-b py-1.5 last:border-0">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-md"
                    style={auditTileStyle(auditCategory(entry.action))}
                  >
                    <Icon className="size-3" />
                  </span>
                  <span className="truncate text-xs">{actionLabel(entry.action)}</span>
                  <SourceChip app={entry.sourceApp} className="max-sm:hidden" />
                  <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                    <RelativeTime date={entry.occurredAt} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawRange = searchParams.get('range');
  const range = isStatsRange(rawRange) ? rawRange : '24h';
  const { data: stats, error, isValidating, mutate } = useStats(range);

  const activeMemoriesAdded = useMemo(
    () => (stats ? stats.memoriesOverTime.reduce((sum, r) => sum + r.count, 0) : 0),
    [stats],
  );
  const recordedActivity = useMemo(
    () => (stats ? stats.actionsOverTime.reduce((sum, r) => sum + r.count, 0) : 0),
    [stats],
  );

  const hint = RANGE_HINTS[range];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Your active memories and recorded Echo activity at a glance."
        actions={
          <Tabs value={range} onValueChange={(value) => setSearchParams(value === '24h' ? {} : { range: value })}>
            <TabsList>
              {STATS_RANGES.map((r) => (
                <TabsTrigger key={r} value={r} className="px-2.5">
                  {r}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />
      {!stats && error ? (
        <RequestErrorState error={error} onRetry={() => mutate()} />
      ) : !stats ? (
        <DashboardSkeleton />
      ) : stats.totalMemories === 0 ? (
        <EmptyState
          icon={<ZapIcon />}
          title="Start building shared context"
          description="Connect an AI app so it can remember and recall context through Echo, or add your first memory manually."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/connect" className={cn(buttonVariants())}>
                Connect an app
              </Link>
              <Link to="/memories" className={cn(buttonVariants({ variant: 'outline' }))}>
                Add a memory
              </Link>
            </div>
          }
        />
      ) : (
        <div className={cn('space-y-4 transition-opacity', isValidating && 'opacity-60')}>
          {/* dqnamo-style tray: tinted bordered shell with concentric inner cards. */}
          <div className="grid gap-1.5 rounded-[16px] border border-grayscale-3 bg-grayscale-2 p-1.5 sm:grid-cols-3">
            <StatTile label="Total memories" value={stats.totalMemories} hint="All time, every scope you can see" />
            <StatTile label="Active memories added" value={activeMemoriesAdded} hint={hint} />
            <StatTile label="Recorded activity" value={recordedActivity} hint={hint} />
          </div>

          <div className="grid gap-2 rounded-[16px] border border-grayscale-3 bg-grayscale-2 p-1.5">
            <MemoriesChart stats={stats} />
            <ActivityChart stats={stats} />
          </div>

          <div className="grid gap-1.5 rounded-[16px] border border-grayscale-3 bg-grayscale-2 p-1.5 lg:grid-cols-2">
            <SourceAppsChart stats={stats} />
            <RecentActivity />
          </div>
        </div>
      )}
    </div>
  );
}

/** Loading stand-in for the dashboard body: stat tray, charts, bottom tray. */
function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid gap-1.5 rounded-[16px] border border-grayscale-3 bg-grayscale-2 p-1.5 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <PreviewCardSkeleton key={i} />
        ))}
      </div>
      <ChartCardSkeleton />
      <ChartCardSkeleton />
      <div className="grid gap-1.5 rounded-[16px] border border-grayscale-3 bg-grayscale-2 p-1.5 lg:grid-cols-2">
        <ChartCardSkeleton height="h-72" />
        <ChartCardSkeleton height="h-72" />
      </div>
    </div>
  );
}
