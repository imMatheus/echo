// End-to-end smoke test for Echo (ECHO_BASE_URL defaults to 127.0.0.1:8080).
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import pg from '../apps/server/node_modules/pg/lib/index.js';
const { Client } = pg;
const BASE = (process.env.ECHO_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://echo:echo@localhost:5433/echo';
const AUTH_TOKEN_SECRET =
  process.env.AUTH_TOKEN_SECRET || 'echo-development-auth-token-secret-change-before-deploying';
const RUN = Date.now().toString(36);
let passed = 0, failed = 0;

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}

function cookieFrom(res) {
  const raw = res.headers.get('set-cookie') ?? '';
  const m = raw.match(/echo_session=([^;]+)/);
  return m ? `echo_session=${m[1]}` : '';
}

async function api(method, path, { body, cookie, bearer } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, res };
}

async function mcp(payload, bearer) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {
    // SSE-framed response: take the first data: line
    const m = text.match(/^data: (.*)$/m);
    if (m) json = JSON.parse(m[1]);
  }
  return { status: res.status, json, text, res };
}

async function authToken(email, purpose) {
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT token.id, token.user_id
       FROM auth_tokens AS token
       JOIN users AS account ON account.id = token.user_id
       WHERE account.email = $1 AND token.purpose = $2 AND token.used_at IS NULL
       ORDER BY token.created_at DESC LIMIT 1`,
      [email, purpose],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`No ${purpose} token found for ${email}`);
    const signature = createHmac('sha256', AUTH_TOKEN_SECRET)
      .update(`echo-auth-token\0${purpose}\0${row.id}\0${row.user_id}`)
      .digest('base64url');
    return `${row.id}.${signature}`;
  } finally {
    await client.end().catch(() => {});
  }
}

console.log('— auth —');
const aliceEmail = `alice-${RUN}@example.com`;
const bobEmail = `bob-${RUN}@example.com`;
const sigA = await api('POST', '/auth/signup', { body: { email: aliceEmail, password: 'password-alice', name: 'Alice' } });
check('signup alice 200', sigA.status === 200, JSON.stringify(sigA.json));
check('signup requires verification and has no session', sigA.json?.verificationRequired === true && !cookieFrom(sigA.res));

const unverifiedLogin = await api('POST', '/auth/login', { body: { email: aliceEmail, password: 'password-alice' } });
check('unverified login blocked', unverifiedLogin.status === 403 && unverifiedLogin.json?.error?.code === 'email_not_verified');
const verifyA = await api('POST', '/auth/verify-email', { body: { token: await authToken(aliceEmail, 'verify_email') } });
let cookieA = cookieFrom(verifyA.res);
check('alice verification creates session', verifyA.status === 200 && cookieA.length > 20);

const sigB = await api('POST', '/auth/signup', { body: { email: bobEmail, password: 'password-bob!', name: 'Bob' } });
check('signup bob 200', sigB.status === 200);
const verifyB = await api('POST', '/auth/verify-email', { body: { token: await authToken(bobEmail, 'verify_email') } });
const cookieB = cookieFrom(verifyB.res);
check('bob verification creates session', verifyB.status === 200 && cookieB.length > 20);

const meA = await api('GET', '/auth/me', { cookie: cookieA });
check('me returns user + personalScopeId', meA.json?.user?.name === 'Alice' && !!meA.json?.personalScopeId);
check('API responses are never cached', meA.res.headers.get('cache-control') === 'no-store');
const aliceScope = meA.json.personalScopeId;

const badLogin = await api('POST', '/auth/login', { body: { email: `alice-${RUN}@example.com`, password: 'wrong-password' } });
check('bad login 401', badLogin.status === 401);

const unknownReset = await api('POST', '/auth/forgot-password', { body: { email: `missing-${RUN}@example.com` } });
const knownReset = await api('POST', '/auth/forgot-password', { body: { email: aliceEmail } });
check('password reset request does not enumerate accounts', unknownReset.status === 200 && knownReset.status === 200);
const resetToken = await authToken(aliceEmail, 'password_reset');
const reset = await api('POST', '/auth/reset-password', { body: { token: resetToken, password: 'new-password-alice' } });
check('password reset succeeds', reset.status === 200);
const resetReuse = await api('POST', '/auth/reset-password', { body: { token: resetToken, password: 'another-password' } });
check('password reset token is one-time', resetReuse.status === 400 && resetReuse.json?.error?.code === 'password_reset_invalid');
const revokedByReset = await api('GET', '/auth/me', { cookie: cookieA });
check('password reset revokes existing sessions', revokedByReset.status === 401);
const reloginA = await api('POST', '/auth/login', { body: { email: aliceEmail, password: 'new-password-alice' } });
cookieA = cookieFrom(reloginA.res);
check('new password logs in', reloginA.status === 200 && cookieA.length > 20);

const noAuth = await api('GET', '/memories');
check('unauthenticated list 401', noAuth.status === 401);

console.log('— personal memories —');
const m1 = await api('POST', '/memories', { cookie: cookieA, body: { content: 'Alice prefers TypeScript strict mode and pnpm for all new projects', tags: ['preferences', 'tooling'] } });
check('create memory 201', m1.status === 201, JSON.stringify(m1.json));
check('memory defaults: explicit, personal scope, dashboard source', m1.json?.memory?.kind === 'explicit' && m1.json?.memory?.scopeId === aliceScope && m1.json?.memory?.sourceApp === 'dashboard');

const m2 = await api('POST', '/memories', { cookie: cookieA, body: { content: 'Alice is allergic to peanuts', sensitivity: 'high', kind: 'inferred', confidence: 0.8 } });
check('create high-sensitivity inferred memory', m2.status === 201 && m2.json.memory.sensitivity === 'high' && m2.json.memory.confidence === 0.8);

const m3 = await api('POST', '/memories', { cookie: cookieA, body: { content: 'Currently traveling in Portugal until August', expiresAt: new Date(Date.now() + 86400e3).toISOString() } });
check('create expiring memory', m3.status === 201 && !!m3.json.memory.expiresAt);

const pastExpiry = await api('POST', '/memories', { cookie: cookieA, body: { content: 'Already stale', expiresAt: new Date(Date.now() - 1000).toISOString() } });
check('reject already-expired memory', pastExpiry.status === 400, `status=${pastExpiry.status}`);

const listA = await api('GET', '/memories', { cookie: cookieA });
check('alice lists 3 active memories', listA.json?.total === 3, `total=${listA.json?.total}`);

const literalWildcard = await api('GET', '/memories?q=%25', { cookie: cookieA });
check('substring filter treats % literally', literalWildcard.json?.total === 0, `total=${literalWildcard.json?.total}`);

const search = await api('POST', '/memories/search', { cookie: cookieA, body: { query: 'typescript tooling' } });
check('search returns fts mode (no provider)', search.json?.mode === 'fts', JSON.stringify(search.json));
check('search finds the tooling memory first', search.json?.results?.[0]?.content?.includes('TypeScript'), JSON.stringify(search.json?.results?.map(r => r.content)));

const patch = await api('PATCH', `/memories/${m1.json.memory.id}`, { cookie: cookieA, body: { tags: [' Preferences ', 'tooling', 'TOOLING', 'TypeScript'], confidence: 0.95 } });
check('patch normalizes and deduplicates tags', patch.status === 200 && JSON.stringify(patch.json.memory.tags) === JSON.stringify(['preferences', 'tooling', 'typescript']) && patch.json.memory.confidence === 0.95);

const shortLived = await api('POST', '/memories', { cookie: cookieA, body: { content: 'Short-lived exact-read check', expiresAt: new Date(Date.now() + 1000).toISOString() } });
check('create short-lived memory', shortLived.status === 201);

let expiredExact = await api('GET', `/memories/${shortLived.json.memory.id}`, { cookie: cookieA });
const expirationDeadline = Date.now() + 5000;
while (expiredExact.status !== 404 && Date.now() < expirationDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  expiredExact = await api('GET', `/memories/${shortLived.json.memory.id}`, { cookie: cookieA });
}
check('exact read hides an expired unswept memory', expiredExact.status === 404, `status=${expiredExact.status}`);
const eraseExpired = await api('DELETE', `/memories/${shortLived.json.memory.id}`, { cookie: cookieA });
check('exact delete permanently erases an expired retained memory', eraseExpired.status === 200, `status=${eraseExpired.status}`);

console.log('— privacy boundary —');
const bobList = await api('GET', '/memories', { cookie: cookieB });
check('bob sees zero of alice memories', bobList.json?.total === 0);
const bobPeek = await api('GET', `/memories/${m2.json.memory.id}`, { cookie: cookieB });
check('bob cannot fetch alice personal memory (404)', bobPeek.status === 404);
const bobSearch = await api('POST', '/memories/search', { cookie: cookieB, body: { query: 'peanuts allergy' } });
check('bob search finds nothing personal', bobSearch.json?.results?.length === 0);

console.log('— organizations —');
const org = await api('POST', '/orgs', { cookie: cookieA, body: { name: `Acme ${RUN}` } });
check('create org 201', org.status === 201, JSON.stringify(org.json));
check('organization response has no slug', !('slug' in (org.json?.org ?? {})), JSON.stringify(org.json?.org));
const orgId = org.json?.org?.id;

const scopes1 = await api('GET', '/scopes', { cookie: cookieA });
const orgScope = scopes1.json?.scopes?.find(s => s.type === 'organization' && s.orgId === orgId);
check('org scope auto-created and accessible', !!orgScope);
check('alice canManage org scope', orgScope?.canManage === true);

const addBob = await api('POST', `/orgs/${orgId}/members`, { cookie: cookieA, body: { email: bobEmail, role: 'member' } });
check('add bob as member 201', addBob.status === 201);

const ghost = await api('POST', `/orgs/${orgId}/members`, { cookie: cookieA, body: { email: 'ghost@example.com' } });
check('adding unknown email 404', ghost.status === 404);

const orgMem = await api('POST', '/memories', { cookie: cookieA, body: { content: 'BigQuery table analytics.events_v3 is the canonical event stream', scopeId: orgScope.id, tags: ['bigquery'] } });
check('alice writes org memory', orgMem.status === 201);

const bobList2 = await api('GET', '/memories', { cookie: cookieB });
check('bob sees exactly the org memory', bobList2.json?.total === 1 && bobList2.json?.memories?.[0]?.scopeType === 'organization');

const bobEdit = await api('PATCH', `/memories/${orgMem.json.memory.id}`, { cookie: cookieB, body: { content: 'vandalized' } });
check('bob (member, not creator) cannot edit org memory (403)', bobEdit.status === 403, `status=${bobEdit.status}`);

const team = await api('POST', '/scopes', { cookie: cookieA, body: { orgId, type: 'team', name: 'Platform' } });
check('create team scope 201', team.status === 201);
const teamMem = await api('POST', '/memories', { cookie: cookieA, body: { content: 'Platform team deploys via ArgoCD on Fridays', scopeId: team.json.scope.id } });
check('alice writes team memory', teamMem.status === 201);

const orgScopeMembers = await api('GET', `/scopes/${orgScope.id}/members`, { cookie: cookieB });
check('organization scope lists organization members', orgScopeMembers.status === 200 && orgScopeMembers.json?.members?.length === 2);

const hiddenTeamMembers = await api('GET', `/scopes/${team.json.scope.id}/members`, { cookie: cookieB });
check('inaccessible nested scope does not leak members (404)', hiddenTeamMembers.status === 404, `status=${hiddenTeamMembers.status}`);

const bobScopes = await api('GET', '/scopes', { cookie: cookieB });
check('bob does not see team scope (not a member)', !bobScopes.json?.scopes?.some(s => s.id === team.json.scope.id));

const addBobTeam = await api('POST', `/scopes/${team.json.scope.id}/members`, { cookie: cookieA, body: { email: bobEmail } });
check('add bob to team scope', addBobTeam.status === 201);
const bobScopes2 = await api('GET', '/scopes', { cookie: cookieB });
check('bob now sees team scope', bobScopes2.json?.scopes?.some(s => s.id === team.json.scope.id));

const demote = await api('PATCH', `/orgs/${orgId}/members/${meA.json.user.id}`, { cookie: cookieA, body: { role: 'member' } });
check('last owner cannot demote self (400)', demote.status === 400, `status=${demote.status}`);

console.log('— api keys + REST bearer —');
const key = await api('POST', '/api-keys', { cookie: cookieA, body: { name: 'Claude Code', sourceApp: 'claude-code' } });
check('create api key returns secret once', key.status === 201 && key.json?.secret?.startsWith('eck_'));
const secret = key.json.secret;

const bearerList = await api('GET', '/memories', { bearer: secret });
check('bearer auth lists memories', bearerList.json?.total >= 4, `total=${bearerList.json?.total}`);
const bearerKeyList = await api('GET', '/api-keys', { bearer: secret });
check('bearer key cannot list sibling credentials', bearerKeyList.status === 401, `status=${bearerKeyList.status}`);
const bearerMint = await api('POST', '/api-keys', { bearer: secret, body: { name: 'persistence attempt' } });
check('bearer key cannot mint replacement credentials', bearerMint.status === 401, `status=${bearerMint.status}`);
const lowercaseBearer = await fetch(`${BASE}/api/v1/memories`, {
  headers: { authorization: `bearer ${secret}` },
});
check('bearer auth scheme is case-insensitive', lowercaseBearer.status === 200, `status=${lowercaseBearer.status}`);

const badBearer = await api('GET', '/memories', { bearer: 'eck_not-a-real-key' });
check('invalid bearer 401', badBearer.status === 401);

console.log('— MCP —');
const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }, secret);
check('mcp initialize ok', init.json?.result?.serverInfo?.name === 'echo-context', JSON.stringify(init.json ?? init.text).slice(0, 300));
check('MCP responses are never cached', init.res.headers.get('cache-control') === 'no-store');

const toolsList = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, secret);
const toolNames = toolsList.json?.result?.tools?.map(t => t.name)?.sort();
check('mcp lists 5 tools', JSON.stringify(toolNames) === JSON.stringify(['forget_context', 'list_context', 'list_scopes', 'recall_context', 'remember_context']), JSON.stringify(toolNames));

const remember = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'remember_context', arguments: { content: 'Alice reviews PRs before standup every morning', kind: 'inferred', confidence: 0.7, tags: ['habits'] } } }, secret);
const rememberPayload = JSON.parse(remember.json?.result?.content?.[0]?.text ?? '{}');
check('mcp remember_context stores memory', rememberPayload.stored === true && rememberPayload.memory?.source_app === 'claude-code', remember.text?.slice(0, 300));

const recall = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'recall_context', arguments: { query: 'standup habits' } } }, secret);
const recallPayload = JSON.parse(recall.json?.result?.content?.[0]?.text ?? '{}');
check('mcp recall_context finds it', recallPayload.count >= 1 && recallPayload.results?.some(r => r.content.includes('standup')), recall.text?.slice(0, 300));

const scopesTool = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_scopes', arguments: {} } }, secret);
const scopesPayload = JSON.parse(scopesTool.json?.result?.content?.[0]?.text ?? '{}');
check('mcp list_scopes shows personal + org + team', scopesPayload.scopes?.length === 3, JSON.stringify(scopesPayload));

const uppercaseScopeRecall = await mcp({ jsonrpc: '2.0', id: 51, method: 'tools/call', params: { name: 'recall_context', arguments: { query: 'canonical event stream', scope: orgScope.id.toUpperCase() } } }, secret);
const uppercaseScopePayload = JSON.parse(uppercaseScopeRecall.json?.result?.content?.[0]?.text ?? '{}');
check('MCP accepts uppercase scope UUIDs', uppercaseScopePayload.results?.some(r => r.id === orgMem.json.memory.id), uppercaseScopeRecall.text?.slice(0, 300));

const rememberOrg = await mcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'remember_context', arguments: { content: 'Deploys are frozen during December', scope: `Acme ${RUN}` } } }, secret);
const rememberOrgPayload = JSON.parse(rememberOrg.json?.result?.content?.[0]?.text ?? '{}');
check('mcp remember into org scope by name', rememberOrgPayload.memory?.scope?.includes('organization'), rememberOrg.text?.slice(0, 200));

const forget = await mcp({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'forget_context', arguments: { memory_id: rememberPayload.memory.id } } }, secret);
const forgetPayload = JSON.parse(forget.json?.result?.content?.[0]?.text ?? '{}');
check('mcp forget_context deletes', forgetPayload.deleted === true);

const noAuthMcp = await mcp({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} });
check('mcp without key 401', noAuthMcp.status === 401);

const bridgeSmoke = spawnSync(process.execPath, ['packages/mcp-bridge/test/smoke.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, ECHO_URL: BASE, ECHO_API_KEY: secret },
  encoding: 'utf8',
  timeout: 15_000,
});
check(
  'stdio MCP bridge lists and calls tools',
  bridgeSmoke.status === 0,
  `${bridgeSmoke.stdout ?? ''}${bridgeSmoke.stderr ?? ''}`.trim().slice(0, 500),
);

console.log('— audit —');
const auditA = await api('GET', '/audit', { cookie: cookieA });
const actions = auditA.json?.entries?.map(e => e.action) ?? [];
check('personal audit has creates/recalls/deletes', actions.includes('memory.create') && actions.includes('memory.recall') && actions.includes('memory.delete'), JSON.stringify(actions.slice(0, 10)));
check('personal audit excludes per-org read fanout rows', !auditA.json?.entries?.some(e => e.details?.orgFanout));
const mcpEntry = auditA.json?.entries?.find(e => e.action === 'memory.create' && e.sourceApp === 'claude-code');
check('audit records source app + api key name', !!mcpEntry && mcpEntry.apiKeyName === 'Claude Code');

const orgAudit = await api('GET', `/orgs/${orgId}/audit`, { cookie: cookieA });
const orgActions = orgAudit.json?.entries?.map(e => e.action) ?? [];
check('org audit shows org events', orgActions.includes('memory.create') && orgActions.includes('org.member_add'), JSON.stringify(orgActions.slice(0, 10)));
const orgRecall = orgAudit.json?.entries?.find(e => e.action === 'memory.recall');
check('org audit recall rows omit query text', !orgRecall || orgRecall.details?.query === undefined);
const orgList = orgAudit.json?.entries?.find(e => e.action === 'memory.list');
check('unscoped API list is audited per org without filters', !!orgList && orgList.details?.orgFanout === true && orgList.details?.filters === undefined);
const deleteEntry = auditA.json?.entries?.find(e => e.action === 'memory.delete');
check('delete audit does not retain memory content', !deleteEntry || deleteEntry.details?.contentPreview === undefined);

const bobOrgAudit = await api('GET', `/orgs/${orgId}/audit`, { cookie: cookieB });
check('member cannot read org audit (403)', bobOrgAudit.status === 403);

console.log('— concurrent ownership invariant —');
const promoteBob = await api('PATCH', `/orgs/${orgId}/members/${verifyB.json.user.id}`, { cookie: cookieA, body: { role: 'owner' } });
check('promote bob to owner', promoteBob.status === 200);
const concurrentDemotions = await Promise.all([
  api('PATCH', `/orgs/${orgId}/members/${meA.json.user.id}`, { cookie: cookieA, body: { role: 'member' } }),
  api('PATCH', `/orgs/${orgId}/members/${verifyB.json.user.id}`, { cookie: cookieB, body: { role: 'member' } }),
]);
const demotionStatuses = concurrentDemotions.map((result) => result.status).sort();
check('concurrent demotions preserve one owner', JSON.stringify(demotionStatuses) === JSON.stringify([200, 400]), JSON.stringify(demotionStatuses));
const membersAfterRace = await api('GET', `/orgs/${orgId}/members`, { cookie: cookieA });
check('organization still has exactly one owner', membersAfterRace.json?.members?.filter((member) => member.role === 'owner').length === 1);

console.log('— key revocation —');
const revoke = await api('DELETE', `/api-keys/${key.json.key.id}`, { cookie: cookieA });
check('revoke key', revoke.status === 200);
const deadBearer = await api('GET', '/memories', { bearer: secret });
check('revoked key 401', deadBearer.status === 401);

console.log('— dashboard static —');
const home = await fetch(`${BASE}/`);
const homeText = await home.text();
check('serves dashboard index.html', home.status === 200 && homeText.includes('<div id="root">'));
check(
  'dashboard shell revalidates and sends browser security headers',
  home.headers.get('cache-control') === 'no-cache' &&
    home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"),
);
const assetPath = homeText.match(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/)?.[1];
const asset = assetPath ? await fetch(`${BASE}${assetPath}`) : null;
check(
  'fingerprinted dashboard assets are cached immutably',
  asset?.status === 200 && asset.headers.get('cache-control')?.includes('immutable'),
  `asset=${assetPath ?? 'not found'}`,
);
const missingAsset = await fetch(`${BASE}/assets/missing-${RUN}.js`);
check('missing dashboard assets return 404', missingAsset.status === 404, `status=${missingAsset.status}`);
const spa = await fetch(`${BASE}/memories/00000000-0000-0000-0000-000000000000`);
check('SPA fallback for client routes', spa.status === 200 && (await spa.text()).includes('<div id="root">'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
