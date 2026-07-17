import { describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  accessibleScopeIdsQuery,
  getAccessibleScopes,
  getScopeAccess,
  resolveScopeSelector,
  type ScopeAccess,
  toScopeWithAccess,
} from '@/core/access';
import type { AppContext } from '@/types';

const PERSONAL_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_TEAM_ID = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown>;

/** Build an AppContext whose db.execute returns queued row sets and records queries. */
function appWithRows(rowSets: Row[][]): { app: AppContext; queries: unknown[] } {
  const queries: unknown[] = [];
  let call = 0;
  const app = {
    db: {
      execute: vi.fn(async (query: unknown) => {
        queries.push(query);
        return { rows: rowSets[Math.min(call++, rowSets.length - 1)] ?? [] };
      }),
    },
  } as unknown as AppContext;
  return { app, queries };
}

const personalRow: Row = {
  id: PERSONAL_ID,
  type: 'personal',
  name: 'Personal',
  org_id: null,
  user_id: 'user-1',
  created_at: '2024-01-01T00:00:00.000Z',
  org_name: null,
  org_role: null,
  is_scope_member: false,
  memory_count: 3,
};

const teamRow: Row = {
  id: TEAM_ID,
  type: 'team',
  name: 'Platform Team',
  org_id: 'org-1',
  user_id: null,
  created_at: '2024-02-02T00:00:00.000Z',
  org_name: 'Acme',
  org_role: 'member',
  is_scope_member: true,
  memory_count: 7,
};

describe('getAccessibleScopes', () => {
  it('maps raw rows to typed scope access and normalizes db string columns', async () => {
    const { app } = appWithRows([[personalRow, teamRow]]);
    const scopes = await getAccessibleScopes(app, 'user-1');

    expect(scopes).toHaveLength(2);
    const [personal, team] = scopes;

    expect(personal.id).toBe(PERSONAL_ID);
    expect(personal.type).toBe('personal');
    expect(personal.createdAt).toBeInstanceOf(Date);
    expect(personal.canWrite).toBe(true);
    // Personal scopes are always managed by their owner.
    expect(personal.canManage).toBe(true);
    expect(personal.memoryCount).toBe(3);

    // A non-owner org member can read but not manage the scope.
    expect(team.canManage).toBe(false);
    expect(team.orgName).toBe('Acme');
    expect(team.memoryCount).toBe(7);
  });

  it('treats an org owner as a manager of org-owned scopes', async () => {
    const { app } = appWithRows([[{ ...teamRow, org_role: 'owner' }]]);
    const [team] = await getAccessibleScopes(app, 'user-1');
    expect(team.canManage).toBe(true);
  });
});

describe('getScopeAccess', () => {
  it('returns null when the scope is missing or not visible to the user', async () => {
    const { app } = appWithRows([[]]);
    expect(await getScopeAccess(app, 'user-1', TEAM_ID)).toBeNull();
  });

  it('returns the mapped scope when the row is present', async () => {
    const { app } = appWithRows([[teamRow]]);
    const scope = await getScopeAccess(app, 'user-1', TEAM_ID);
    expect(scope?.id).toBe(TEAM_ID);
    expect(scope?.name).toBe('Platform Team');
  });
});

describe('toScopeWithAccess', () => {
  it('serializes createdAt to an ISO string and preserves access flags', () => {
    const access: ScopeAccess = {
      id: TEAM_ID,
      type: 'team',
      name: 'Platform Team',
      orgId: 'org-1',
      orgName: 'Acme',
      userId: null,
      createdAt: new Date('2024-02-02T00:00:00.000Z'),
      canWrite: true,
      canManage: false,
      memoryCount: 7,
    };
    expect(toScopeWithAccess(access)).toEqual({
      id: TEAM_ID,
      type: 'team',
      name: 'Platform Team',
      orgId: 'org-1',
      orgName: 'Acme',
      userId: null,
      createdAt: '2024-02-02T00:00:00.000Z',
      canWrite: true,
      canManage: false,
      memoryCount: 7,
    });
  });
});

describe('accessibleScopeIdsQuery', () => {
  it('produces a SQL fragment (the shared authorization predicate)', () => {
    const query = accessibleScopeIdsQuery('user-1');
    expect(query).toBeInstanceOf(sql``.constructor);
  });
});

describe('resolveScopeSelector', () => {
  it('defaults to the personal scope for undefined and the "personal" keyword', async () => {
    const both = appWithRows([[personalRow, teamRow]]);
    expect((await resolveScopeSelector(both.app, 'user-1', undefined)).scope?.id).toBe(PERSONAL_ID);

    const keyword = appWithRows([[personalRow, teamRow]]);
    expect((await resolveScopeSelector(keyword.app, 'user-1', 'PERSONAL')).scope?.id).toBe(PERSONAL_ID);
  });

  it('resolves a UUID selector case-insensitively', async () => {
    const { app } = appWithRows([[personalRow, teamRow]]);
    const result = await resolveScopeSelector(app, 'user-1', TEAM_ID.toUpperCase());
    expect(result.scope?.id).toBe(TEAM_ID);
  });

  it('returns no scope for a UUID the user cannot access', async () => {
    const { app } = appWithRows([[personalRow]]);
    const result = await resolveScopeSelector(app, 'user-1', TEAM_ID);
    expect(result.scope).toBeNull();
    expect(result.error).toBeUndefined();
  });

  it('matches a scope by case-insensitive name and org-qualified name', async () => {
    const byName = appWithRows([[personalRow, teamRow]]);
    expect((await resolveScopeSelector(byName.app, 'user-1', 'platform team')).scope?.id).toBe(TEAM_ID);

    const byQualified = appWithRows([[personalRow, teamRow]]);
    expect((await resolveScopeSelector(byQualified.app, 'user-1', 'Acme/Platform Team')).scope?.id).toBe(TEAM_ID);
  });

  it('reports an ambiguous name match with every candidate id', async () => {
    const duplicate: Row = { ...teamRow, id: OTHER_TEAM_ID, org_name: null };
    const { app } = appWithRows([[teamRow, duplicate]]);
    const result = await resolveScopeSelector(app, 'user-1', 'Platform Team');
    expect(result.scope).toBeNull();
    expect(result.error).toContain('ambiguous');
    expect(result.error).toContain(TEAM_ID);
    expect(result.error).toContain(OTHER_TEAM_ID);
  });

  it('lists the available scopes when no name matches', async () => {
    const { app } = appWithRows([[personalRow, teamRow]]);
    const result = await resolveScopeSelector(app, 'user-1', 'nonexistent');
    expect(result.scope).toBeNull();
    expect(result.error).toContain('No accessible scope named');
    expect(result.error).toContain('Acme/Platform Team');
    expect(result.error).toContain('[personal]');
  });
});
