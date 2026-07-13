import type { ScopeWithAccess } from '@echo/shared';
import { SelectGroup, SelectItem, SelectLabel } from '@/components/ui/select';

function scopeLabel(scope: ScopeWithAccess): string {
  return scope.type === 'personal' ? scope.name : `${scope.name} (${scope.type})`;
}

/**
 * `items` value→label map for the Select root, so the trigger renders scope
 * names instead of raw ids. Pass `extra` for sentinel entries ("All scopes").
 */
export function scopeSelectItems(
  scopes: ScopeWithAccess[],
  extra?: Array<{ value: string; label: string }>,
): Array<{ value: string; label: string }> {
  return [...(extra ?? []), ...scopes.map((s) => ({ value: s.id, label: scopeLabel(s) }))];
}

/**
 * Select items for scopes, grouped personal vs per-org.
 * Render inside a <SelectContent>.
 */
export function ScopeSelectItems({ scopes }: { scopes: ScopeWithAccess[] }) {
  const personal = scopes.filter((s) => s.type === 'personal');
  const orgScopes = scopes.filter((s) => s.type !== 'personal');
  const orgNames: string[] = [];
  for (const s of orgScopes) {
    const name = s.orgName ?? 'Organization';
    if (!orgNames.includes(name)) orgNames.push(name);
  }

  return (
    <>
      {personal.length > 0 && (
        <SelectGroup>
          <SelectLabel>Personal</SelectLabel>
          {personal.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
      {orgNames.map((orgName) => (
        <SelectGroup key={orgName}>
          <SelectLabel>{orgName}</SelectLabel>
          {orgScopes
            .filter((s) => (s.orgName ?? 'Organization') === orgName)
            .map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.type})
              </SelectItem>
            ))}
        </SelectGroup>
      ))}
    </>
  );
}
