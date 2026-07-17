// OpenAI-compatible mock embeddings API: deterministic bag-of-words vectors so
// that texts sharing words get high cosine similarity.
import { createServer } from 'node:http';

const DIM = 16;
const SHORT_DIM_MARKER = '[short-vector]';
const SLOW_MARKER = '[slow-embedding]';
let slowRequests = 0;
const heldSlowResponses = [];

function embed(text) {
  const dimensions = text.includes(SHORT_DIM_MARKER) ? 8 : DIM;
  const v = new Array(dimensions).fill(0);
  for (const word of text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % dimensions] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ slowRequests, heldRequests: heldSlowResponses.length }));
    return;
  }
  if (req.method === 'POST' && req.url === '/release-slow') {
    const pending = heldSlowResponses.splice(0);
    for (const respond of pending) respond();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ released: pending.length }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { input } = JSON.parse(body);
    const texts = Array.isArray(input) ? input : [input];
    const respond = () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: texts.map((t, i) => ({ index: i, embedding: embed(t) })) }));
    };
    if (texts.some((text) => String(text).includes(SLOW_MARKER))) {
      slowRequests += 1;
      // The race smoke explicitly releases this response after the membership
      // revocation commits. A barrier is deterministic even on a loaded runner.
      heldSlowResponses.push(respond);
    } else {
      respond();
    }
  });
}).listen(9999, '127.0.0.1', () => console.log('mock embeddings on 127.0.0.1:9999'));
