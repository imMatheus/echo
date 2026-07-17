import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { STATS_RANGES } from '@echo/shared';
import type { UsageStats } from '@echo/shared';
import type { AuditQuery } from '../api';
import * as api from '../api';
import { AuditTable } from '../components/AuditTable';
import { ChartEmpty } from '../components/ChartEmpty';
import { PageHeader } from '../components/PageHeader';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStats } from '@/hooks';
import { AUDIT_CATEGORIES, OTHER_CATEGORY, auditCategory } from '@/lib/audit';
import { formatBucket, formatBucketLong, isStatsRange, timeAxisTicks } from '@/lib/stats';
import { cn } from '@/lib/utils';

/**
 * Stacked bars of audit events per bucket, one series per event category.
 * Series keys, order, and colors come from AUDIT_CATEGORIES, so every bar
 * segment matches the icon tint of the same category in the feed below.
 */
function ActivityByCategoryChart({ stats }: { stats: UsageStats }) {
  const { data, series, config } = useMemo(() => {
    const totals = new Map<string, number>();
    const byBucket = new Map<string, Record<string, number>>();
    for (const row of stats.actionsOverTime) {
      const key = auditCategory(row.action).key;
      totals.set(key, (totals.get(key) ?? 0) + row.count);
      const entry = byBucket.get(row.bucket) ?? {};
      entry[key] = (entry[key] ?? 0) + row.count;
      byBucket.set(row.bucket, entry);
    }
    // Categories keep their fixed order and entity-bound color even as the
    // range changes; empty ones are dropped so the legend stays honest.
    const present = [...AUDIT_CATEGORIES, OTHER_CATEGORY].filter((c) => (totals.get(c.key) ?? 0) > 0);
    const config: ChartConfig = {};
    for (const c of present) config[c.key] = { label: c.label, color: c.color };
    const series = present.map((c) => c.key);
    const data = stats.buckets.map((bucket) => ({
      bucket,
      ...Object.fromEntries(series.map((s) => [s, 0])),
      ...byBucket.get(bucket),
    }));
    return { data, series, config };
  }, [stats]);

  if (series.length === 0) {
    return <ChartEmpty className="h-48" message="No activity in this period yet." />;
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-48 w-full">
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
            stackId="events"
            fill={`var(--color-${key})`}
            // 1px card-colored stroke = the surface gap between stacked segments.
            stroke="var(--card)"
            strokeWidth={1}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

export default function AuditPage() {
  const fetchPage = useCallback((q: AuditQuery) => api.getAudit(q), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawRange = searchParams.get('range');
  const range = isStatsRange(rawRange) ? rawRange : '7d';
  const { data: stats, error, isValidating } = useStats(range);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Every action taken by you or your API keys — writes, recalls, and changes."
      />
      <Card size="sm" className={cn('mb-4 transition-opacity', stats && isValidating && 'opacity-60')}>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            {stats ? `Audit events per ${stats.granularity}, by event type.` : 'Audit events over time, by event type.'}
          </CardDescription>
          <CardAction>
            <Tabs
              value={range}
              onValueChange={(value) =>
                setSearchParams(value === '7d' ? {} : { range: value }, {
                  replace: true,
                })
              }
            >
              <TabsList>
                {STATS_RANGES.map((r) => (
                  <TabsTrigger key={r} value={r} className="px-2.5">
                    {r}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardAction>
        </CardHeader>
        <CardContent>
          {stats ? (
            <ActivityByCategoryChart stats={stats} />
          ) : error ? (
            <ChartEmpty className="h-48" message="Couldn't load activity stats." />
          ) : (
            <Skeleton className="h-48 w-full" aria-hidden />
          )}
        </CardContent>
      </Card>
      <AuditTable fetchPage={fetchPage} scopeKey="personal" />
    </div>
  );
}
