import type { MemoryKind, OrgRole, ScopeType, Sensitivity } from '@echo/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const SCOPE_CLASSES: Record<ScopeType, string> = {
  personal: 'border-chart-1 bg-chart-1 text-chart-1-foreground',
  organization: 'border-scope-organization/30 bg-scope-organization/10 text-scope-organization',
  team: 'border-scope-team/30 bg-scope-team/10 text-scope-team',
  project: 'border-scope-project/30 bg-scope-project/10 text-scope-project',
  workspace: 'border-scope-workspace/30 bg-scope-workspace/10 text-scope-workspace',
};

/** Scope badge — colored by scope type, shows the scope name (or the type). */
export function ScopeBadge({ type, name }: { type: ScopeType; name?: string }) {
  return (
    <Badge className={cn('max-w-full', SCOPE_CLASSES[type])} title={name ? `${name} (${type} scope)` : `${type} scope`}>
      {name ?? type}
    </Badge>
  );
}

/** Memory kind — explicit is solid, inferred is outlined with a ≈ prefix. */
export function KindBadge({ kind }: { kind: MemoryKind }) {
  if (kind === 'inferred') {
    return (
      <Badge variant="outline" className="text-muted-foreground" title="Inferred by a model">
        ≈ inferred
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" title="Explicitly remembered">
      explicit
    </Badge>
  );
}

export function SensitivityBadge({ sensitivity }: { sensitivity: Sensitivity }) {
  if (sensitivity === 'normal') return null;
  return (
    <Badge
      variant={sensitivity === 'high' ? 'destructive' : 'secondary'}
      className={sensitivity === 'low' ? 'text-muted-foreground' : undefined}
      title="Sensitivity"
    >
      {sensitivity === 'high' ? 'high sensitivity' : 'low sensitivity'}
    </Badge>
  );
}

/** Small monospace chip for source apps and similar identifiers. */
export function SourceChip({ app, className }: { app: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('max-w-full rounded-md font-mono text-muted-foreground', className)}
      title={`Source app: ${app}`}
    >
      {app}
    </Badge>
  );
}

const ROLE_CLASSES: Record<OrgRole, string | undefined> = {
  owner: 'border-scope-personal/30 bg-scope-personal/10 text-scope-personal',
  admin: 'border-scope-organization/30 bg-scope-organization/10 text-scope-organization',
  member: undefined,
};

export function RoleBadge({ role }: { role: OrgRole }) {
  return (
    <Badge variant={role === 'member' ? 'secondary' : 'default'} className={ROLE_CLASSES[role]}>
      {role}
    </Badge>
  );
}

export function Tag({ tag }: { tag: string }) {
  return (
    <Badge variant="secondary" className="max-w-full rounded-md text-muted-foreground" title={`Tag: ${tag}`}>
      #{tag}
    </Badge>
  );
}
