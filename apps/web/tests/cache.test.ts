import { describe, expect, test } from 'bun:test';
import {
  isAuthorizationDependentKey,
  isAuthorizationSnapshotKey,
  isMemorySearchKey,
  keys,
  scopeAccessSignature,
} from '../src/hooks';

describe('authorization cache helpers', () => {
  test('separates replay-safe GET snapshots from audited search POSTs', () => {
    const searchKey = keys.search('query', 'all');

    expect(isMemorySearchKey(searchKey)).toBe(true);
    expect(isAuthorizationSnapshotKey(searchKey)).toBe(false);
    expect(isAuthorizationSnapshotKey(keys.memories({ limit: 50 }))).toBe(true);
    expect(isAuthorizationSnapshotKey(keys.memory('memory-id'))).toBe(true);
    expect(isAuthorizationDependentKey(keys.scopes)).toBe(true);
    expect(isAuthorizationDependentKey(keys.apiKeys)).toBe(false);
  });

  test('scope access signature is order-independent and tracks management changes', () => {
    const reader = { id: 'scope-a', canWrite: true, canManage: false };
    const manager = { ...reader, canManage: true };
    const second = { id: 'scope-b', canWrite: true, canManage: false };

    expect(scopeAccessSignature([reader, second])).toBe(scopeAccessSignature([second, reader]));
    expect(scopeAccessSignature([reader])).not.toBe(scopeAccessSignature([manager]));
  });
});
