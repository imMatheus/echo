import type { ScopeWithAccess } from '@echo/shared';

/**
 * <option> list for a scope <select>, grouped personal vs per-org.
 * Render inside a <select>.
 */
export function ScopeOptions({ scopes }: { scopes: ScopeWithAccess[] }) {
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
        <optgroup label="Personal">
          {personal.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
      {orgNames.map((orgName) => (
        <optgroup key={orgName} label={orgName}>
          {orgScopes
            .filter((s) => (s.orgName ?? 'Organization') === orgName)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.type})
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
