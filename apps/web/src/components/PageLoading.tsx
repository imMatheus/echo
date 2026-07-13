import { Spinner } from '@/components/ui/spinner';

/** Centered spinner for a whole page / panel while it loads. */
export function PageLoading() {
  return (
    <div className="flex justify-center py-20">
      <Spinner className="size-6" />
    </div>
  );
}
