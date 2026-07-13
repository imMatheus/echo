import { loadConfig, VERSION } from './config';
import { sweepMemories } from './core/memories';
import { createPool, migrate, type Db } from './db';
import { createEmbeddingProvider } from './lib/embeddings';
import { buildApp } from './http/app';
import type { AppContext } from './types';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

async function waitForDb(db: Db, attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`waiting for database (${i}/${attempts})...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPool(config.DATABASE_URL);
  await waitForDb(db);
  await migrate(db, (msg) => console.log(msg));

  const app: AppContext = {
    db,
    config,
    embeddings: createEmbeddingProvider(config),
    log: console,
  };

  const fastify = await buildApp(app);
  app.log = fastify.log;

  const sweep = () =>
    sweepMemories(app).catch((err) => fastify.log.error({ err }, 'memory sweep failed'));
  sweep();
  const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    fastify.log.info(`${signal} received, shutting down`);
    clearInterval(sweepTimer);
    await fastify.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await fastify.listen({ port: config.PORT, host: config.HOST });
  fastify.log.info(
    `Echo v${VERSION} ready — embeddings: ${app.embeddings ? app.embeddings.modelId : 'none (full-text search only)'}`,
  );
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
