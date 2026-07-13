import { useCallback } from 'react';
import type { AuditQuery } from '../api';
import * as api from '../api';
import { AuditTable } from '../components/AuditTable';

export default function AuditPage() {
  const fetchPage = useCallback((q: AuditQuery) => api.getAudit(q), []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p className="subtitle">Every action taken by you or your API keys — writes, recalls, and changes.</p>
        </div>
      </div>
      <AuditTable fetchPage={fetchPage} />
    </div>
  );
}
