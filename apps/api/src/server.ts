import { readFileSync } from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createLogger } from './logger.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const config = loadConfig();
const logger = createLogger(config.logLevel, config.env === 'development');
const database = await connectDatabase(config.mongoUri, config.mongoDbName);

const app = createApp({ pingDatabase: database.ping, version, logger });
const server = app.listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await database.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
