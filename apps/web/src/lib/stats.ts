import { STATS_RANGES } from '@echo/shared';
import type { StatsRange, UsageStats } from '@echo/shared';

/** Display helpers for /stats time buckets, shared by every stats chart. */

export function isStatsRange(value: string | null): value is StatsRange {
  return (STATS_RANGES as readonly string[]).includes(value ?? '');
}

/**
 * Axis-tick label for a bucket. Day buckets are UTC days and format in UTC;
 * hour buckets are instants and format in the viewer's local time as "19:00" /
 * "7:00 PM" (locale-dependent) — except local midnight, which shows the date
 * instead so the day boundary inside the 24h window is visible.
 */
export function formatBucket(bucket: string, granularity: UsageStats['granularity']): string {
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
export function formatBucketLong(bucket: string, granularity: UsageStats['granularity']): string {
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
export function timeAxisTicks(stats: UsageStats): string[] | undefined {
  if (stats.granularity !== 'hour') return undefined;
  return stats.buckets.filter((b) => new Date(b).getHours() % 2 === 0);
}
