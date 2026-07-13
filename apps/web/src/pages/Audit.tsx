import { useCallback } from 'react';
import type { AuditQuery } from '../api';
import * as api from '../api';
import { AuditTable } from '../components/AuditTable';
import { PageHeader } from '../components/PageHeader';

export default function AuditPage() {
  const fetchPage = useCallback((q: AuditQuery) => api.getAudit(q), []);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Every action taken by you or your API keys — writes, recalls, and changes."
      />
      <AuditTable fetchPage={fetchPage} />
    </div>
  );
}
