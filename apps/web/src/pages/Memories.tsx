import { useEffect, useState } from 'react';
import type { ScopeWithAccess } from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { MemoryBrowser } from '../components/MemoryBrowser';
import { PageLoading } from '../components/Spinner';
import { useToast } from '../components/Toast';

export default function MemoriesPage() {
  const toast = useToast();
  const { personalScopeId } = useAuth();
  const [scopes, setScopes] = useState<ScopeWithAccess[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listScopes()
      .then((res) => {
        if (!cancelled) setScopes(res.scopes);
      })
      .catch((err) => {
        if (!cancelled) toast.error(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  if (scopes === null) return <PageLoading />;

  return (
    <MemoryBrowser
      scopes={scopes}
      heading="Memories"
      allowAllScopes
      defaultScopeId={personalScopeId ?? undefined}
    />
  );
}
