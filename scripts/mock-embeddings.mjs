// OpenAI-compatible mock embeddings API: deterministic bag-of-words vectors so
// that texts sharing words get high cosine similarity.
import { createServer } from 'node:http';

const DIM = 16;

function embed(text) {
  const v = new Array(DIM).fill(0);
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { input } = JSON.parse(body);
    const texts = Array.isArray(input) ? input : [input];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: texts.map((t, i) => ({ index: i, embedding: embed(t) })) }));
  });
}).listen(9999, () => console.log('mock embeddings on :9999'));
