import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from './schema';
import { runPostMigrations } from './post-migrations';

/** The Drizzle database handle, threaded everywhere as `app.db`. */
export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

export function createDb(
  databaseUrl: string,
  onPoolError: (error: Error) => void = (error) => console.error('unexpected idle database client error', error),
): Db {
  const pool = new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 10_000 });
  // pg-pool emits idle-client failures on the pool. An unhandled EventEmitter
  // "error" event terminates the process, so always install a listener.
  pool.on('error', onPoolError);
  return drizzle(pool, { schema });
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Apply every pending Drizzle migration in drizzle/, tracked in __drizzle_migrations. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  // Drizzle checks the journal before opening its transaction but does not take
  // a cross-process lock. Hold a session advisory lock on the same dedicated
  // connection used by the migrator so horizontally-starting replicas serialize.
  const client = await db.$client.connect();
  const migrationDb = drizzle(client, { schema });
  const lockKey = 0x4543484f; // ASCII "ECHO", stable across deployments.
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
    locked = true;
    await drizzleMigrate(migrationDb, { migrationsFolder: MIGRATIONS_DIR });
    // Drizzle wraps migrations in a transaction. Resumable cleanup batches and
    // concurrent index builds must run after that transaction has committed.
    await runPostMigrations(client, log);
    log('migrations up to date');
  } finally {
    let releaseError: Error | undefined;
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]).catch((error) => {
        log(`failed to release migration advisory lock: ${String(error)}`);
        releaseError = error instanceof Error ? error : new Error(String(error));
      });
    }
    // Destroy a connection if unlock failed; returning it to the pool could keep
    // the session-level lock alive and block every later replica indefinitely.
    client.release(releaseError);
  }
}

export * as schema from './schema';
