import { loadConfig, VERSION } from './config';
import { sweepMemories } from './core/memories';
import { processEmailOutbox, sweepAuthEmailData } from './core/email-delivery';
import { createDb } from './db';
import { createEmbeddingProvider } from './lib/embeddings';
import { createEmailProvider } from './email/provider';
import { buildApp } from './http/app';
import type { AppContext } from './types';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const EMAIL_DISPATCH_INTERVAL_MS = 10 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  // Migrations are NOT run here — apply them explicitly with `bun run db:migrate`.
  // The pool connects lazily, so startup does not touch the database.
  const db = createDb(config.DATABASE_URL);

  const app: AppContext = {
    db,
    config,
    embeddings: createEmbeddingProvider(config),
    email: createEmailProvider(config),
    log: console,
  };

  const fastify = await buildApp(app);
  app.log = fastify.log;

  const sweep = () => {
    void sweepMemories(app).catch((err) => fastify.log.error({ err }, 'memory sweep failed'));
    void sweepAuthEmailData(app).catch((err) => fastify.log.error({ err }, 'auth/email sweep failed'));
  };
  sweep();
  const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);

  let emailDispatchRunning = false;
  const dispatchEmail = async () => {
    if (emailDispatchRunning) return;
    emailDispatchRunning = true;
    try {
      await processEmailOutbox(app);
    } catch (err) {
      fastify.log.error({ err }, 'email outbox dispatch failed');
    } finally {
      emailDispatchRunning = false;
    }
  };
  void dispatchEmail();
  const emailDispatchTimer = setInterval(() => void dispatchEmail(), EMAIL_DISPATCH_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    fastify.log.info(`${signal} received, shutting down`);
    clearInterval(sweepTimer);
    clearInterval(emailDispatchTimer);
    await fastify.close();
    await db.$client.end();
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
