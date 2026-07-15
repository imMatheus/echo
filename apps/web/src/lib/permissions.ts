import type { Memory, ScopeWithAccess } from '@echo/shared';

/** Mirrors the server's memory mutation rule for safely gating dashboard controls. */
export function canModifyMemory(
  memory: Pick<Memory, 'createdBy' | 'scopeId'>,
  userId: string | null | undefined,
  scopes: Array<Pick<ScopeWithAccess, 'id' | 'canManage'>> | undefined,
): boolean {
  if (!userId) return false;
  if (memory.createdBy === userId) return true;
  return scopes?.some((scope) => scope.id === memory.scopeId && scope.canManage) ?? false;
}
