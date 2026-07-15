import { cn } from '@/lib/utils';

/** Centered placeholder shown inside a chart card when the period has no data. */
export function ChartEmpty({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('flex h-64 items-center justify-center text-xs text-muted-foreground', className)}>
      {message}
    </div>
  );
}
