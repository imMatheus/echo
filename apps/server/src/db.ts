import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Db = pg.Pool;

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Apply every migrations/*.sql not yet recorded in _migrations, in filename order. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await db.query<{ name: string }>('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}
