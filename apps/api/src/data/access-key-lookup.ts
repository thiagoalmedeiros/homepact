import type { Db } from 'mongodb';
import type { AccessKeyDoc } from '../modules/access-keys/keys.js';

/** Cross-tenant lookup by key hash; the caller refuses a key of another company's origin (403). */
export const findAccessKeyByHash = (db: Db, hash: string): Promise<AccessKeyDoc | null> =>
  db.collection<AccessKeyDoc>('accessKeys').findOne({ hash });
