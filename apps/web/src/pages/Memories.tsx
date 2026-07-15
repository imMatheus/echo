import { PlusIcon } from 'lucide-react';
import { useAuth } from '@/auth';
import { MemoryBrowser } from '@/components/MemoryBrowser';
import { PageHeader } from '@/components/PageHeader';
import { RequestErrorState } from '@/components/RequestErrorState';
import { MemoryFiltersSkeleton, MemoryGridSkeleton } from '@/components/Skeletons';
import { Button } from '@/components/ui/button';
import { useScopes } from '@/hooks';

const HEADING = 'Memories';
const SUBHEADING = 'Everything you and your AI tools have remembered, across all your scopes.';

export default function MemoriesPage() {
  const { personalScopeId } = useAuth();
  const { data: scopes, error, mutate } = useScopes();

  if (!scopes && error) return <RequestErrorState error={error} onRetry={() => mutate()} />;

  // Scopes gate the whole browser (filters + create modal), but the page chrome
  // doesn't depend on them — render it immediately and skeleton only the rest.
  if (!scopes) {
    return (
      <div>
        <PageHeader
          title={HEADING}
          subtitle={SUBHEADING}
          actions={
            <Button disabled>
              <PlusIcon data-icon="inline-start" />
              New memory
            </Button>
          }
        />
        <MemoryFiltersSkeleton />
        <MemoryGridSkeleton />
      </div>
    );
  }

  return (
    <MemoryBrowser
      scopes={scopes}
      heading={HEADING}
      subheading={SUBHEADING}
      allowAllScopes
      defaultScopeId={personalScopeId ?? undefined}
    />
  );
}
