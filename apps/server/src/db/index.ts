import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from './schema';
import { runPostMigrations } from './post-migrations';

/** The Drizzle database handle, threaded everywhere as `app.db`. */
export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

/**
 * node-postgres' connection-string parser cannot handle `sslrootcert=system` —
 * a libpq keyword (Postgres 16+) meaning "trust the operating system CA store".
 * It instead tries to `readFileSync('system')` and crashes. Managed providers
 * such as PlanetScale emit exactly that. Node's TLS already verifies against the
 * bundled public CA roots those providers use, so drop the keyword and keep TLS
 * on through `sslmode`. Every other URL is returned untouched.
 */
export function normalizeDatabaseUrl(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl; // libpq key=value DSN or similar — hand it to pg as-is.
  }
  if (url.searchParams.get('sslrootcert') !== 'system') return databaseUrl;
  url.searchParams.delete('sslrootcert');
  if (!url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'require');
  return url.toString();
}

export function createDb(
  databaseUrl: string,
  onPoolError: (error: Error) => void = (error) => console.error('unexpected idle database client error', error),
): Db {
  const pool = new Pool({
    connectionString: normalizeDatabaseUrl(databaseUrl),
    max: 10,
    connectionTimeoutMillis: 10_000,
  });
  // pg-pool emits idle-client failures on the pool. An unhandled EventEmitter
  // "error" event terminates the process, so always install a listener.
  pool.on('error', onPoolError);
  return drizzle(pool, { schema });
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const MIGRATION_LOCK_KEY = 0x4543484f; // ASCII "ECHO", stable across deployments.
const MIGRATION_LOCK_TIMEOUT_MS = 5 * 60_000;

/** Apply every pending Drizzle migration in drizzle/, tracked in __drizzle_migrations. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  // Drizzle checks the journal before opening its transaction but does not take
  // a cross-process lock. Hold a session advisory lock on the same dedicated
  // connection used by the migrator so horizontally-starting replicas serialize.
  const client = await db.$client.connect();
  const migrationDb = drizzle(client, { schema });
  let locked = false;
  try {
    // Try-with-deadline rather than a blocking pg_advisory_lock: session locks
    // leak on transaction-pooled connections (PgBouncer, PlanetScale port 6432),
    // where a blocking acquire would hang every subsequent boot forever.
    const deadline = Date.now() + MIGRATION_LOCK_TIMEOUT_MS;
    while (true) {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        [MIGRATION_LOCK_KEY],
      );
      if (result.rows[0]?.locked === true) {
        locked = true;
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          'timed out waiting for the migration advisory lock; if no other replica is migrating, ' +
            'DATABASE_URL may point at a transaction-pooled port (such as PgBouncer or PlanetScale :6432) ' +
            'that cannot hold session advisory locks — use the direct connection string instead',
        );
      }
      log('waiting for migration advisory lock...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await drizzleMigrate(migrationDb, { migrationsFolder: MIGRATIONS_DIR });
    // Drizzle wraps migrations in a transaction. Resumable cleanup batches and
    // concurrent index builds must run after that transaction has committed.
    await runPostMigrations(client, log);
    log('migrations up to date');
  } finally {
    let releaseError: Error | undefined;
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]).catch((error) => {
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
