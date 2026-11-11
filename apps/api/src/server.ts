import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { ensureIndexes } from './data/indexes.js';
import { runMigrations } from './data/migrations.js';
import { connectDatabase } from './db.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger({ env: config.env, level: config.logLevel });
const database = await connectDatabase(config.mongo, logger);

const MAX_INDEX_ATTEMPTS = 30;
const INDEX_RETRY_DELAY_MS = 2000;

/** Creates the indexes before serving, retrying while MongoDB starts, then exits for the
 * orchestrator to restart. */
const prepareDatabase = async (): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureIndexes(database.db);
      await runMigrations(database.db);
      return;
    } catch (err) {
      if (attempt >= MAX_INDEX_ATTEMPTS) {
        logger.fatal({ err }, 'Could not create indexes; refusing to start');
        process.exit(1);
      }
      logger.warn({ err, attempt }, 'Indexes not ready; retrying');
      await new Promise((r) => setTimeout(r, INDEX_RETRY_DELAY_MS));
    }
  }
};

await prepareDatabase();
const app = createApp({
  db: database.db,
  logger,
  pingDatabase: database.ping,
  platformAdminOrigin: config.platformAdminOrigin,
  jwtSecret: config.jwtSecret,
});

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      url: `http://localhost:${config.port}/api`,
      admin: config.platformAdminOrigin,
    },
    'API listening',
  );
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await database.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
