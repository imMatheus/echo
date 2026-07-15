import { useAuth } from '@/auth';
import { MemoryBrowser } from '@/components/MemoryBrowser';
import { PageLoading } from '@/components/PageLoading';
import { RequestErrorState } from '@/components/RequestErrorState';
import { useScopes } from '@/hooks';

export default function MemoriesPage() {
  const { personalScopeId } = useAuth();
  const { data: scopes, error, mutate } = useScopes();

  if (!scopes && error) return <RequestErrorState error={error} onRetry={() => mutate()} />;
  if (!scopes) return <PageLoading />;

  return (
    <MemoryBrowser
      scopes={scopes}
      heading="Memories"
      subheading="Everything you and your AI tools have remembered, across all your scopes."
      allowAllScopes
      defaultScopeId={personalScopeId ?? undefined}
    />
  );
}
