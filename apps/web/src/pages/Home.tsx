import { useCallback, useMemo, useState } from 'react';
import { ScrollTextIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';
import { STATS_RANGES } from '@echo/shared';
import type { StatsRange, UsageStats } from '@echo/shared';
import type { AuditQuery } from '../api';
import * as api from '../api';
import { SourceChip } from '../components/Badge';
import { PageHeader } from '../components/PageHeader';
import { PageLoading } from '../components/PageLoading';
import { RelativeTime } from '../components/RelativeTime';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAudit, useStats } from '@/hooks';
import { cn } from '@/lib/utils';

const RANGE_HINTS: Record<StatsRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

/**
 * Max distinctly-colored series in the tool-calls stack; the rest fold into
 * "Other". The theme's chart ramp is a single-hue lightness scale, and only
 * every-other step is reliably distinguishable (incl. under CVD), so three
 * spaced steps is the ceiling for categorical use.
 */
const MAX_ACTION_SERIES = 3;
const ACTION_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-4)'];

/** Human-readable legend/tooltip labels for audit actions. */
const ACTION_LABELS: Record<string, string> = {
  'memory.create': 'Memory created',
  'memory.update': 'Memory updated',
  'memory.delete': 'Memory deleted',
  'memory.get': 'Memory viewed',
  'memory.list': 'Memories listed',
  'memory.recall': 'Memory recalled',
  'memory.merge': 'Memories merged',
  'memory.similar': 'Similarity check',
  'apikey.create': 'API key created',
  'apikey.revoke': 'API key revoked',
  'auth.login': 'Login',
  'auth.signup': 'Signup',
  'org.create': 'Org created',
  'org.update': 'Org updated',
  'org.member_add': 'Org member added',
  'org.member_update': 'Org member updated',
  'scope.create': 'Scope created',
  'scope.delete': 'Scope deleted',
  'scope.member_add': 'Scope member added',
  'scope.member_remove': 'Scope member removed',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Axis-tick label for a bucket. Day buckets are UTC days and format in UTC;
 * hour buckets are instants and format in the viewer's local time as "19:00" /
 * "7:00 PM" (locale-dependent) — except local midnight, which shows the date
 * instead so the day boundary inside the 24h window is visible.
 */
function formatBucket(bucket: string, granularity: UsageStats['granularity']): string {
  if (granularity === 'hour') {
    const d = new Date(bucket);
    if (d.getHours() === 0) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return new Date(`${bucket}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Fuller bucket label for tooltips ("Jul 14" / "14 Jul, 19:00"). */
function formatBucketLong(bucket: string, granularity: UsageStats['granularity']): string {
  if (granularity === 'hour') {
    return new Date(bucket).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return formatBucket(bucket, granularity);
}

/**
 * Explicit X ticks for hour granularity: every other bucket, anchored to even
 * local hours so the midnight tick (rendered as the date) survives whenever
 * the axis has room (recharts still thins under minTickGap on narrow screens).
 * Day granularity returns undefined and keeps recharts' automatic ticks.
 */
function timeAxisTicks(stats: UsageStats): string[] | undefined {
  if (stats.granularity !== 'hour') return undefined;
  return stats.buckets.filter((b) => new Date(b).getHours() % 2 === 0);
}

/** Recharts treats dots in dataKey as a path lookup, so series keys can't be raw actions. */
function seriesKey(action: string): string {
  return action.replace(/\W/g, '_');
}

function StatTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight">{compact.format(value)}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">{message}</div>
  );
}

function MemoriesChart({ stats }: { stats: UsageStats }) {
  const data = useMemo(() => {
    const byBucket = new Map(stats.memoriesOverTime.map((r) => [r.bucket, r.count]));
    return stats.buckets.map((bucket) => ({ bucket, count: byBucket.get(bucket) ?? 0 }));
  }, [stats]);

  const config = {
    count: { label: 'Memories', color: 'var(--chart-2)' },
  } satisfies ChartConfig;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Memories over time</CardTitle>
        <CardDescription>
          New memories per {stats.granularity} across your scopes.
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
              dataKey="count"
              type="monotone"
              stroke="var(--color-count)"
              strokeWidth={2}
              fill="var(--color-count)"
              fillOpacity={0.1}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function ToolCallsChart({ stats }: { stats: UsageStats }) {
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
      config[seriesKey(action)] = { label: actionLabel(action), color: ACTION_COLORS[i] };
    });
    if (hasOther) config.other = { label: 'Other', color: 'var(--muted-foreground)' };

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
        <CardTitle>Tool calls</CardTitle>
        <CardDescription>
          Actions recorded per {stats.granularity}, by type — recalls, writes, and admin.
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
                  maxBarSize={24}
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
  const data = useMemo(() => stats.sourceApps.slice(0, 6), [stats]);

  const config = {
    count: { label: 'Events', color: 'var(--chart-2)' },
  } satisfies ChartConfig;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Activity by source app</CardTitle>
        <CardDescription>Where your memory activity comes from.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <ChartEmpty message="No activity in this period yet." />
        ) : (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 36 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="sourceApp"
                tickLine={false}
                axisLine={false}
                width={110}
                tick={{ fontSize: 11 }}
              />
              <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
              <Bar dataKey="count" fill="var(--color-count)" barSize={16} isAnimationActive={false}>
                <LabelList dataKey="count" position="right" className="fill-muted-foreground" fontSize={11} />
              </Bar>
            </BarChart>
          </ChartContainer>
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
        {/* Empty state only once the fetch has settled — no flash while loading. */}
        {data && entries.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <ScrollTextIcon className="size-4" />
            No activity yet.
          </div>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 border-b py-2 last:border-0"
              >
                <Badge variant="outline" className="rounded-md font-mono">
                  {entry.action}
                </Badge>
                <SourceChip app={entry.sourceApp} className="max-sm:hidden" />
                <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                  <RelativeTime date={entry.occurredAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const [range, setRange] = useState<StatsRange>('24h');
  const { data: stats, isLoading, isValidating } = useStats(range);

  const memoriesInRange = useMemo(
    () => (stats ? stats.memoriesOverTime.reduce((sum, r) => sum + r.count, 0) : 0),
    [stats],
  );
  const toolCallsInRange = useMemo(
    () => (stats ? stats.actionsOverTime.reduce((sum, r) => sum + r.count, 0) : 0),
    [stats],
  );

  if (!stats && isLoading) return <PageLoading />;
  if (!stats) return null; // fetch error — already toasted

  const hint = RANGE_HINTS[stats.range];

  return (
    <div>
      <PageHeader
        title="Home"
        subtitle="Your Echo usage at a glance — memories, recalls, and where they come from."
        actions={
          <Tabs value={range} onValueChange={(value) => setRange(value as StatsRange)}>
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
      <div className={cn('space-y-4 transition-opacity', isValidating && 'opacity-60')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Total memories" value={stats.totalMemories} hint="All time, every scope you can see" />
          <StatTile label="New memories" value={memoriesInRange} hint={hint} />
          <StatTile label="Tool calls" value={toolCallsInRange} hint={hint} />
        </div>
        <MemoriesChart stats={stats} />
        <ToolCallsChart stats={stats} />
        <div className="grid gap-4 lg:grid-cols-2">
          <SourceAppsChart stats={stats} />
          <RecentActivity />
        </div>
      </div>
    </div>
  );
}
