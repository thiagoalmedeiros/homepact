import { MongoClient, type Db } from 'mongodb';
import { createMemoryDatabase } from './data/memory-db.js';
import type { Logger } from './logger.js';

export interface Database {
  db: Db;
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

const MEMORY_SCHEME = 'memory:';

/** Creates the MongoDB client; it connects lazily, so the API boots (with degraded health) while
 * the database is down. `memory:` (or `memory:<file>` to keep the data in a file) uses the
 * JavaScript stand-in instead, for running without mongod. */
export const connectDatabase = async (
  { uri, dbName }: { uri: string; dbName: string },
  logger: Logger,
): Promise<Database> => {
  if (uri.startsWith(MEMORY_SCHEME)) {
    const file = uri.slice(MEMORY_SCHEME.length) || undefined;
    const memory = createMemoryDatabase(file ? { file } : {});
    logger.info({ file: file ?? null }, 'Using the in-memory database');
    return { db: memory.db, ping: async () => {}, close: async () => memory.flush() };
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, ignoreUndefined: true });
  const db = client.db(dbName);

  try {
    await client.connect();
    logger.info({ dbName }, 'Connected to MongoDB');
  } catch (err) {
    logger.warn({ err, dbName }, 'MongoDB not reachable yet; will retry on demand');
  }

  return {
    db,
    ping: async () => {
      await db.command({ ping: 1 });
    },
    close: () => client.close(),
  };
};
