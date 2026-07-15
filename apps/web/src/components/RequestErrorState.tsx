import { useState } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { errorMessage } from '@/api';
import { EmptyState } from './EmptyState';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export function RequestErrorState({
  error,
  onRetry,
  title = 'Could not load this page',
}: {
  error: unknown;
  onRetry: () => Promise<unknown>;
  title?: string;
}) {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      // The owning SWR hook retains and displays the latest error.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <EmptyState
      icon={<TriangleAlertIcon />}
      title={title}
      description={errorMessage(error)}
      action={
        <Button variant="outline" onClick={() => void retry()} disabled={retrying}>
          {retrying && <Spinner />}
          Retry
        </Button>
      }
    />
  );
}
