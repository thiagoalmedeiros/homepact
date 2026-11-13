import type {
  Db,
  Document,
  Filter,
  FindOptions,
  OptionalUnlessRequiredId,
  UpdateFilter,
  UpdateOptions,
} from 'mongodb';

export interface TenantDoc extends Document {
  _id: string;
  companyId: string | null;
}

export type NewDoc<T extends TenantDoc> = Omit<T, 'companyId'>;

export interface TenantCollection<T extends TenantDoc> {
  find(filter?: Filter<T>, options?: FindOptions): Promise<T[]>;
  findOne(filter: Filter<T>): Promise<T | null>;
  insertOne(doc: NewDoc<T>): Promise<T>;
  updateOne(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: UpdateOptions,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;
  findOneAndUpdate(filter: Filter<T>, update: UpdateFilter<T>): Promise<T | null>;
  updateMany(filter: Filter<T>, update: UpdateFilter<T>): Promise<{ modifiedCount: number }>;
  deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }>;
  countDocuments(filter?: Filter<T>): Promise<number>;
}

export interface TenantRepo {
  readonly companyId: string | null;
  of<T extends TenantDoc>(name: CollectionName): TenantCollection<T>;
}

export type CollectionName =
  | 'users'
  | 'refreshTokens'
  | 'areas'
  | 'catalogItems'
  | 'packages'
  | 'houses'
  | 'inventoryHomes'
  | 'proposals'
  | 'revisions'
  | 'changeRequests'
  | 'proposalMessages'
  | 'accessKeys'
  | 'agreementTemplates'
  | 'agreements'
  | 'agreementFiles'
  | 'agreementPayments'
  | 'taxRates'
  | 'referralPrograms';

const PLATFORM_SCOPE = { $eq: null, $exists: true } as const;

/** The only way modules reach tenant data: every filter and insert is forced to `companyId`. `null`
 * scopes to platform records, whose `companyId` is explicitly null (never missing). */
export const tenantRepo = (db: Db, companyId: string | null): TenantRepo => ({
  companyId,
  of<T extends TenantDoc>(name: CollectionName): TenantCollection<T> {
    const col = db.collection<T>(name);
    const companyScope = companyId === null ? PLATFORM_SCOPE : companyId;
    const scope = (filter: Filter<T> = {}): Filter<T> =>
      ({ ...filter, companyId: companyScope }) as Filter<T>;
    return {
      find: (filter, options) => col.find(scope(filter), options).toArray() as Promise<T[]>,
      findOne: (filter) => col.findOne(scope(filter)) as Promise<T | null>,
      insertOne: async (doc) => {
        const full = { ...doc, companyId } as unknown as T;
        await col.insertOne(full as OptionalUnlessRequiredId<T>);
        return full;
      },
      updateOne: async (filter, update, options) => {
        const r = await col.updateOne(scope(filter), guardUpdate(update), options);
        return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount };
      },
      findOneAndUpdate: (filter, update) =>
        col.findOneAndUpdate(scope(filter), guardUpdate(update), {
          returnDocument: 'after',
        }) as Promise<T | null>,
      updateMany: async (filter, update) => {
        const r = await col.updateMany(scope(filter), guardUpdate(update));
        return { modifiedCount: r.modifiedCount };
      },
      deleteOne: async (filter) => {
        const r = await col.deleteOne(scope(filter));
        return { deletedCount: r.deletedCount };
      },
      countDocuments: (filter) => col.countDocuments(scope(filter)),
    };
  },
});

/** Updates may never move a document to another company. */
const guardUpdate = <T>(update: UpdateFilter<T>): UpdateFilter<T> => {
  if (Array.isArray(update)) throw new Error('Pipeline updates are not allowed');
  for (const [op, fields] of Object.entries(update)) {
    if (!op.startsWith('$')) throw new Error('Replacement updates are not allowed');
    if (fields && typeof fields === 'object' && 'companyId' in fields) {
      throw new Error('companyId cannot be updated');
    }
  }
  return update;
};
