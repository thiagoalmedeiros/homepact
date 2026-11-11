import { MongoClient, type Db } from 'mongodb';
import type { Logger } from './logger.js';

export interface Database {
  db: Db;
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

/** Creates the MongoDB client; it connects lazily, so the API boots (with degraded health) while
 * the database is down. */
export const connectDatabase = async (
  { uri, dbName }: { uri: string; dbName: string },
  logger: Logger,
): Promise<Database> => {
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
