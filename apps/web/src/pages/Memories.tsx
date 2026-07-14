import { useAuth } from '@/auth';
import { MemoryBrowser } from '@/components/MemoryBrowser';
import { PageLoading } from '@/components/PageLoading';
import { useScopes } from '@/hooks';

export default function MemoriesPage() {
  const { personalScopeId } = useAuth();
  const { data: scopes } = useScopes();

  if (!scopes) return <PageLoading />;

  return (
    <MemoryBrowser
      scopes={scopes}
      heading="Memories"
      allowAllScopes
      defaultScopeId={personalScopeId ?? undefined}
    />
  );
}
