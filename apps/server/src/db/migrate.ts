import { loadConfig } from '../config';
import { createDb, migrate } from './index';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

try {
  await migrate(db, (message) => console.log(message));
} finally {
  await db.$client.end();
}
