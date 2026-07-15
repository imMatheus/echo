import { describe, expect, test } from 'bun:test';
import { canModifyMemory } from '../src/lib/permissions';

const memory = { createdBy: 'creator', scopeId: 'scope-1' };

describe('canModifyMemory', () => {
  test('allows the creator', () => {
    expect(canModifyMemory(memory, 'creator', [])).toBe(true);
  });

  test('allows a manager of the memory scope', () => {
    expect(canModifyMemory(memory, 'manager', [{ id: 'scope-1', canManage: true }])).toBe(true);
  });

  test('does not grant access from another managed scope', () => {
    expect(canModifyMemory(memory, 'manager', [{ id: 'scope-2', canManage: true }])).toBe(false);
  });

  test('denies ordinary readers and unknown users', () => {
    expect(canModifyMemory(memory, 'reader', [{ id: 'scope-1', canManage: false }])).toBe(false);
    expect(canModifyMemory(memory, null, [{ id: 'scope-1', canManage: true }])).toBe(false);
  });
});
