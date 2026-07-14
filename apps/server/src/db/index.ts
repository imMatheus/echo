import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from './schema';

/** The Drizzle database handle, threaded everywhere as `app.db`. */
export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

export function createDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return drizzle(pool, { schema });
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Apply every pending Drizzle migration in drizzle/, tracked in __drizzle_migrations. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_DIR });
  log('migrations up to date');
}

export * as schema from './schema';
