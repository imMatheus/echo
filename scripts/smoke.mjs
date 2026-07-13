// End-to-end smoke test for Echo against a running server on :3246
const BASE = 'http://127.0.0.1:3246';
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
  return { status: res.status, json, text };
}

console.log('— auth —');
const sigA = await api('POST', '/auth/signup', { body: { email: `alice-${RUN}@example.com`, password: 'password-alice', name: 'Alice' } });
check('signup alice 200', sigA.status === 200, JSON.stringify(sigA.json));
const cookieA = cookieFrom(sigA.res);
check('alice got session cookie', cookieA.length > 20);

const sigB = await api('POST', '/auth/signup', { body: { email: `bob-${RUN}@example.com`, password: 'password-bob!', name: 'Bob' } });
const cookieB = cookieFrom(sigB.res);
check('signup bob 200', sigB.status === 200);

const meA = await api('GET', '/auth/me', { cookie: cookieA });
check('me returns user + personalScopeId', meA.json?.user?.name === 'Alice' && !!meA.json?.personalScopeId);
const aliceScope = meA.json.personalScopeId;

const badLogin = await api('POST', '/auth/login', { body: { email: `alice-${RUN}@example.com`, password: 'wrong-password' } });
check('bad login 401', badLogin.status === 401);

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

const listA = await api('GET', '/memories', { cookie: cookieA });
check('alice lists 3 memories', listA.json?.total === 3, `total=${listA.json?.total}`);

const search = await api('POST', '/memories/search', { cookie: cookieA, body: { query: 'typescript tooling' } });
check('search returns fts mode (no provider)', search.json?.mode === 'fts', JSON.stringify(search.json));
check('search finds the tooling memory first', search.json?.results?.[0]?.content?.includes('TypeScript'), JSON.stringify(search.json?.results?.map(r => r.content)));

const patch = await api('PATCH', `/memories/${m1.json.memory.id}`, { cookie: cookieA, body: { tags: ['preferences', 'tooling', 'typescript'], confidence: 0.95 } });
check('patch memory', patch.status === 200 && patch.json.memory.tags.length === 3 && patch.json.memory.confidence === 0.95);

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
const orgId = org.json?.org?.id;

const scopes1 = await api('GET', '/scopes', { cookie: cookieA });
const orgScope = scopes1.json?.scopes?.find(s => s.type === 'organization' && s.orgId === orgId);
check('org scope auto-created and accessible', !!orgScope);
check('alice canManage org scope', orgScope?.canManage === true);

const addBob = await api('POST', `/orgs/${orgId}/members`, { cookie: cookieA, body: { email: `bob-${RUN}@example.com`, role: 'member' } });
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

const bobScopes = await api('GET', '/scopes', { cookie: cookieB });
check('bob does not see team scope (not a member)', !bobScopes.json?.scopes?.some(s => s.id === team.json.scope.id));

const addBobTeam = await api('POST', `/scopes/${team.json.scope.id}/members`, { cookie: cookieA, body: { email: `bob-${RUN}@example.com` } });
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

const badBearer = await api('GET', '/memories', { bearer: 'eck_not-a-real-key' });
check('invalid bearer 401', badBearer.status === 401);

console.log('— MCP —');
const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }, secret);
check('mcp initialize ok', init.json?.result?.serverInfo?.name === 'echo-context', JSON.stringify(init.json ?? init.text).slice(0, 300));

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

const rememberOrg = await mcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'remember_context', arguments: { content: 'Deploys are frozen during December', scope: `Acme ${RUN}` } } }, secret);
const rememberOrgPayload = JSON.parse(rememberOrg.json?.result?.content?.[0]?.text ?? '{}');
check('mcp remember into org scope by name', rememberOrgPayload.memory?.scope?.includes('organization'), rememberOrg.text?.slice(0, 200));

const forget = await mcp({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'forget_context', arguments: { memory_id: rememberPayload.memory.id } } }, secret);
const forgetPayload = JSON.parse(forget.json?.result?.content?.[0]?.text ?? '{}');
check('mcp forget_context deletes', forgetPayload.deleted === true);

const noAuthMcp = await mcp({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} });
check('mcp without key 401', noAuthMcp.status === 401);

console.log('— audit —');
const auditA = await api('GET', '/audit', { cookie: cookieA });
const actions = auditA.json?.entries?.map(e => e.action) ?? [];
check('personal audit has creates/recalls/deletes', actions.includes('memory.create') && actions.includes('memory.recall') && actions.includes('memory.delete'), JSON.stringify(actions.slice(0, 10)));
const mcpEntry = auditA.json?.entries?.find(e => e.action === 'memory.create' && e.sourceApp === 'claude-code');
check('audit records source app + api key name', !!mcpEntry && mcpEntry.apiKeyName === 'Claude Code');

const orgAudit = await api('GET', `/orgs/${orgId}/audit`, { cookie: cookieA });
const orgActions = orgAudit.json?.entries?.map(e => e.action) ?? [];
check('org audit shows org events', orgActions.includes('memory.create') && orgActions.includes('org.member_add'), JSON.stringify(orgActions.slice(0, 10)));
const orgRecall = orgAudit.json?.entries?.find(e => e.action === 'memory.recall');
check('org audit recall rows omit query text', !orgRecall || orgRecall.details?.query === undefined);

const bobOrgAudit = await api('GET', `/orgs/${orgId}/audit`, { cookie: cookieB });
check('member cannot read org audit (403)', bobOrgAudit.status === 403);

console.log('— key revocation —');
const revoke = await api('DELETE', `/api-keys/${key.json.key.id}`, { cookie: cookieA });
check('revoke key', revoke.status === 200);
const deadBearer = await api('GET', '/memories', { bearer: secret });
check('revoked key 401', deadBearer.status === 401);

console.log('— dashboard static —');
const home = await fetch(`${BASE}/`);
const homeText = await home.text();
check('serves dashboard index.html', home.status === 200 && homeText.includes('<div id="root">'));
const spa = await fetch(`${BASE}/memories/00000000-0000-0000-0000-000000000000`);
check('SPA fallback for client routes', spa.status === 200 && (await spa.text()).includes('<div id="root">'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
