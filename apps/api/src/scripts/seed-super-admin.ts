import { loadConfig } from '../config.js';
import { connectDatabase } from '../db.js';
import { ensureIndexes } from '../data/indexes.js';
import { createLogger } from '../logger.js';
import { seedSuperAdmin } from './seed.js';

const config = loadConfig();
const logger = createLogger({ env: config.env, level: config.logLevel });
const email = process.env['SEED_ADMIN_EMAIL'];
const password = process.env['SEED_ADMIN_PASSWORD'];
if (!email || !password || password.length < 8) {
  logger.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 8 characters)');
  process.exit(1);
}
const database = await connectDatabase(config.mongo, logger);
await ensureIndexes(database.db);
await seedSuperAdmin(database.db, { email, password });
logger.info({ email, origin: config.platformAdminOrigin }, 'Super-admin ready');
await database.close();
