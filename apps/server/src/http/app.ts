import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpError } from '@/lib/http-error';
import { mcpRoutes } from '@/mcp/route';
import type { AppContext } from '@/types';
import { apiKeyRoutes } from './routes/apikeys';
import { authRoutes } from './routes/auth';
import { memoryRoutes } from './routes/memories';
import { miscRoutes } from './routes/misc';
import { orgRoutes } from './routes/orgs';
import { scopeRoutes } from './routes/scopes';

function resolveStaticDir(app: AppContext): string | null {
  const candidates = [
    app.config.STATIC_DIR,
    join(dirname(fileURLToPath(import.meta.url)), '../../../web/dist'), // src/http → apps/web/dist
    join(dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

export async function buildApp(app: AppContext): Promise<FastifyInstance> {
  const f = Fastify({
    logger: { level: app.config.LOG_LEVEL },
    trustProxy: app.config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  await f.register(fastifyCors, {
    credentials: true,
    origin: (origin, callback) => callback(null, !origin || origin === app.config.WEB_ORIGIN),
  });

  // CORS prevents script reads, but a cross-site form can still issue a simple
  // unsafe request. Reject browser origins other than the configured dashboard;
  // non-browser MCP clients do not send Origin and keep using bearer auth.
  f.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== app.config.WEB_ORIGIN) {
      throw new HttpError('forbidden', 'Origin is not allowed');
    }
  });

  // The dashboard can display one-time API secrets and private memories. Keep
  // API responses out of caches and apply a small, dependency-free baseline of
  // browser hardening headers to every response.
  f.addHook('onSend', async (req, reply, payload) => {
    reply.header(
      'content-security-policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    );
    reply.header('permissions-policy', 'camera=(), geolocation=(), microphone=()');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    const isApiRequest = req.url.startsWith('/api') || req.url.startsWith('/mcp');
    if (isApiRequest) {
      reply.header('cache-control', 'no-store');
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      // @fastify/static finalizes its generated headers after its setHeaders
      // callback, so enforce the cache policy here. Vite fingerprints files
      // under /assets; an HTML response for that path is the SPA fallback, not
      // a cacheable asset.
      const requestPath = req.url.split('?', 1)[0];
      const contentType = String(reply.getHeader('content-type') ?? '');
      const isFingerprintedAsset =
        reply.statusCode < 400 && requestPath.startsWith('/assets/') && !contentType.startsWith('text/html');
      reply.header(
        'cache-control',
        isFingerprintedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    }
    return payload;
  });

  await f.register(fastifyCookie);
  await f.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => !req.url.startsWith('/api') && !req.url.startsWith('/mcp'),
  });

  f.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send(err.toBody());
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests, slow down' } });
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: { code: 'validation_error', message: (err as Error).message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Internal server error' } });
  });

  await f.register(authRoutes(app), { prefix: '/api/v1' });
  await f.register(memoryRoutes(app), { prefix: '/api/v1' });
  await f.register(scopeRoutes(app), { prefix: '/api/v1' });
  await f.register(orgRoutes(app), { prefix: '/api/v1' });
  await f.register(apiKeyRoutes(app), { prefix: '/api/v1' });
  await f.register(miscRoutes(app), { prefix: '/api/v1' });
  await f.register(mcpRoutes(app));

  const staticDir = resolveStaticDir(app);
  if (staticDir) {
    await f.register(fastifyStatic, { root: staticDir });
    f.setNotFoundHandler((req, reply) => {
      if (
        req.url.startsWith('/api') ||
        req.url.startsWith('/mcp') ||
        req.url.startsWith('/assets/') ||
        req.method !== 'GET'
      ) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
      }
      return reply.sendFile('index.html'); // SPA fallback
    });
  } else {
    f.log.warn('dashboard build not found — serving API only (build apps/web or set STATIC_DIR)');
    f.setNotFoundHandler((req, reply) => {
      reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
    });
  }

  return f;
}
