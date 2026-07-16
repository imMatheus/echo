// Verifies hybrid search (ECHO_BASE_URL defaults to 127.0.0.1:3247).
import pg from '../apps/server/node_modules/pg/lib/index.js';
const { Client } = pg;
const BASE = (process.env.ECHO_BASE_URL ?? 'http://127.0.0.1:3247').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://echo:echo@localhost:5433/echo';
const MOCK_BASE = (process.env.MOCK_EMBEDDINGS_URL ?? 'http://127.0.0.1:9999').replace(/\/+$/, '');
const RUN = `vec-${Date.now().toString(36)}`;
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

async function api(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), res };
}

async function slowRequestCount() {
  const res = await fetch(`${MOCK_BASE}/status`);
  return (await res.json()).slowRequests;
}

async function waitForSlowRequest(previous) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await slowRequestCount()) > previous) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('mock embedding request did not start');
}

async function releaseSlowRequests() {
  const res = await fetch(`${MOCK_BASE}/release-slow`, { method: 'POST' });
  if (!res.ok) throw new Error(`could not release mock embedding request: ${res.status}`);
  const payload = await res.json();
  if (payload.released < 1) throw new Error('mock embedding barrier had no request to release');
}

async function markTestAccountVerified(email) {
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [email]);
  } finally {
    await client.end().catch(() => {});
  }
}

const meta = await api('GET', '/meta');
check('meta reports openai embeddings', meta.json?.embeddings?.provider === 'openai', JSON.stringify(meta.json));

const accountEmail = `${RUN}@example.com`;
await api('POST', '/auth/signup', { body: { email: accountEmail, password: 'password-123', name: 'Vec' } });
await markTestAccountVerified(accountEmail);
const login = await api('POST', '/auth/login', { body: { email: accountEmail, password: 'password-123' } });
const cookie = `echo_session=${login.res.headers.get('set-cookie').match(/echo_session=([^;]+)/)[1]}`;

const contents = [
  'The staging database password rotates every Friday via vault',
  'Alice prefers dark roast coffee from the third floor machine',
  'Deployment pipeline runs terraform apply after manual approval',
];
for (const content of contents) {
  const r = await api('POST', '/memories', { cookie, body: { content } });
  check(`stored with embedding model: ${content.slice(0, 25)}...`, r.json?.memory?.embeddingModel === 'openai:text-embedding-3-small', JSON.stringify(r.json?.memory?.embeddingModel));
}

const s1 = await api('POST', '/memories/search', { cookie, body: { query: 'coffee preferences' } });
check('hybrid mode active', s1.json?.mode === 'hybrid', JSON.stringify(s1.json?.mode));
check('vector match ranks coffee memory first', s1.json?.results?.[0]?.content?.includes('coffee'), JSON.stringify(s1.json?.results?.map(r => [r.content.slice(0, 30), r.score, r.similarity])));
check('similarity populated', typeof s1.json?.results?.[0]?.similarity === 'number');

const s2 = await api('POST', '/memories/search', { cookie, body: { query: 'terraform deployment approval' } });
check('finds pipeline memory', s2.json?.results?.[0]?.content?.includes('terraform'));

// Same provider/model labels can legitimately produce different dimensions
// across endpoint configuration or model upgrades. Mismatched stored vectors
// must be skipped by vector ranking while remaining available to full-text search.
const shortVector = await api('POST', '/memories', {
  cookie,
  body: { content: '[short-vector] dimension compatibility fallback' },
});
check('stores alternate dimensions under the same model label', shortVector.status === 201);
const mixedDimensionSearch = await api('POST', '/memories/search', {
  cookie,
  body: { query: 'dimension compatibility fallback' },
});
const mixedDimensionResult = mixedDimensionSearch.json?.results?.find((result) => result.id === shortVector.json?.memory?.id);
check('mixed-dimension search succeeds', mixedDimensionSearch.status === 200, `status=${mixedDimensionSearch.status}`);
check('mismatched vector falls back to full-text', mixedDimensionResult?.similarity === null, JSON.stringify(mixedDimensionResult));

// Mutation-time authorization regression: access can be revoked while a slow
// embedding call is in flight. The eventual write must re-check membership.
const bobEmail = `${RUN}-bob@example.com`;
await api('POST', '/auth/signup', {
  body: { email: bobEmail, password: 'password-123', name: 'Vector Bob' },
});
await markTestAccountVerified(bobEmail);
const bobLogin = await api('POST', '/auth/login', { body: { email: bobEmail, password: 'password-123' } });
const bobCookie = `echo_session=${bobLogin.res.headers.get('set-cookie').match(/echo_session=([^;]+)/)[1]}`;
const org = await api('POST', '/orgs', { cookie, body: { name: `Vector Race ${RUN}` } });
const orgId = org.json.org.id;
const scopeList = await api('GET', '/scopes', { cookie });
const orgScope = scopeList.json.scopes.find((scope) => scope.orgId === orgId && scope.type === 'organization');
const protectedMemory = await api('POST', '/memories', {
  cookie,
  body: { content: 'revoked search must not reveal this organization memory', scopeId: orgScope.id },
});
await api('POST', `/orgs/${orgId}/members`, {
  cookie,
  body: { email: bobEmail, role: 'member' },
});

let slowBefore = await slowRequestCount();
const pendingSearch = api('POST', '/memories/search', {
  cookie: bobCookie,
  body: {
    query: '[slow-embedding] revoked search organization memory',
    scopeIds: [orgScope.id],
  },
});
await waitForSlowRequest(slowBefore);
await api('DELETE', `/orgs/${orgId}/members/${bobLogin.json.user.id}`, { cookie });
await releaseSlowRequests();
const revokedSearch = await pendingSearch;
check('revoked in-flight search completes safely', revokedSearch.status === 200, `status=${revokedSearch.status}`);
check(
  'revoked in-flight search returns no protected content',
  !revokedSearch.json?.results?.some((memory) => memory.id === protectedMemory.json?.memory?.id),
);

await api('POST', `/orgs/${orgId}/members`, {
  cookie,
  body: { email: bobEmail, role: 'member' },
});

slowBefore = await slowRequestCount();
const pendingCreate = api('POST', '/memories', {
  cookie: bobCookie,
  body: { content: '[slow-embedding] revoked create must not persist', scopeId: orgScope.id },
});
await waitForSlowRequest(slowBefore);
await api('DELETE', `/orgs/${orgId}/members/${bobLogin.json.user.id}`, { cookie });
await releaseSlowRequests();
const revokedCreate = await pendingCreate;
check('revoked in-flight create is rejected', revokedCreate.status === 404, `status=${revokedCreate.status}`);
const afterCreateRace = await api('GET', `/memories?scopeId=${orgScope.id}`, { cookie });
check('revoked in-flight create stores no row', !afterCreateRace.json.memories.some((m) => m.content.includes('revoked create')));

await api('POST', `/orgs/${orgId}/members`, {
  cookie,
  body: { email: bobEmail, role: 'member' },
});
const editable = await api('POST', '/memories', {
  cookie: bobCookie,
  body: { content: 'original content survives revoked update', scopeId: orgScope.id },
});
slowBefore = await slowRequestCount();
const pendingUpdate = api('PATCH', `/memories/${editable.json.memory.id}`, {
  cookie: bobCookie,
  body: { content: '[slow-embedding] unauthorized replacement' },
});
await waitForSlowRequest(slowBefore);
await api('DELETE', `/orgs/${orgId}/members/${bobLogin.json.user.id}`, { cookie });
await releaseSlowRequests();
const revokedUpdate = await pendingUpdate;
check('revoked in-flight update is rejected', revokedUpdate.status === 404, `status=${revokedUpdate.status}`);
const unchanged = await api('GET', `/memories/${editable.json.memory.id}`, { cookie });
check('revoked in-flight update leaves content unchanged', unchanged.json.memory.content === 'original content survives revoked update');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
