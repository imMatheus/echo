import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpError } from '../lib/http-error.js';
import { mcpRoutes } from '../mcp/route.js';
import type { AppContext } from '../types.js';
import { apiKeyRoutes } from './routes/apikeys.js';
import { authRoutes } from './routes/auth.js';
import { memoryRoutes } from './routes/memories.js';
import { miscRoutes } from './routes/misc.js';
import { orgRoutes } from './routes/orgs.js';
import { scopeRoutes } from './routes/scopes.js';

function resolveStaticDir(app: AppContext): string | null {
  const candidates = [
    app.config.STATIC_DIR,
    join(dirname(fileURLToPath(import.meta.url)), '../../../web/dist'), // dist/http → apps/web/dist
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
      if (req.url.startsWith('/api') || req.url.startsWith('/mcp') || req.method !== 'GET') {
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
