import type { MemoryKind, OrgRole, ScopeType, Sensitivity } from '@echo/shared';

/** Scope badge — colored by scope type, shows the scope name (or the type). */
export function ScopeBadge({ type, name }: { type: ScopeType; name?: string }) {
  return (
    <span className={`badge badge-scope-${type}`} title={`${type} scope`}>
      {name ?? type}
    </span>
  );
}

/** Memory kind — explicit is solid, inferred is outlined with a ≈ prefix. */
export function KindBadge({ kind }: { kind: MemoryKind }) {
  if (kind === 'inferred') {
    return (
      <span className="badge badge-kind-inferred" title="Inferred by a model">
        ≈ inferred
      </span>
    );
  }
  return (
    <span className="badge badge-kind-explicit" title="Explicitly remembered">
      explicit
    </span>
  );
}

export function SensitivityBadge({ sensitivity }: { sensitivity: Sensitivity }) {
  if (sensitivity === 'normal') return null;
  return (
    <span className={`badge badge-sensitivity-${sensitivity}`} title="Sensitivity">
      {sensitivity === 'high' ? 'high sensitivity' : 'low sensitivity'}
    </span>
  );
}

/** Small monospace chip for source apps and similar identifiers. */
export function SourceChip({ app }: { app: string }) {
  return (
    <span className="chip-mono" title="Source app">
      {app}
    </span>
  );
}

export function RoleBadge({ role }: { role: OrgRole }) {
  return <span className={`badge badge-role-${role}`}>{role}</span>;
}

export function Tag({ tag }: { tag: string }) {
  return <span className="tag">#{tag}</span>;
}
