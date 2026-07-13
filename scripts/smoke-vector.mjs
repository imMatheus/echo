// Verifies the pgvector hybrid-search path against a mock embedding provider.
const BASE = 'http://127.0.0.1:3247';
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

const meta = await api('GET', '/meta');
check('meta reports openai embeddings', meta.json?.embeddings?.provider === 'openai', JSON.stringify(meta.json));

const sig = await api('POST', '/auth/signup', { body: { email: `${RUN}@example.com`, password: 'password-123', name: 'Vec' } });
const cookie = `echo_session=${sig.res.headers.get('set-cookie').match(/echo_session=([^;]+)/)[1]}`;

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
