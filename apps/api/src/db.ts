import { MongoClient, type Db } from 'mongodb';

export type Database = {
  db: Db;
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
};

export async function connectDatabase(uri: string, dbName: string): Promise<Database> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  return {
    db,
    ping: async () => {
      try {
        const result = await db.command({ ping: 1 });
        return result.ok === 1;
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}
