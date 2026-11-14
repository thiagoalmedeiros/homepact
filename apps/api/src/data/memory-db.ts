import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { find, Query, update as applyUpdate } from 'mingo';
import type { Db } from 'mongodb';

/** A MongoDB stand-in in plain JavaScript, for running the app where mongod cannot be downloaded
 * or started. It covers what the data layer uses (find/findOne with sort, projection, skip and
 * limit; insertOne; updateOne/updateMany/findOneAndUpdate with update operators and upsert;
 * deleteOne/deleteMany; countDocuments; unique indexes) with MongoDB's query and update semantics
 * (mingo). Like the driver with `ignoreUndefined`, undefined fields are not stored, and every read
 * returns a copy. With a `file`, the data is loaded from it and written back after each change, so
 * it outlives the process (the seed and the API run in separate processes). */

type Doc = Record<string, unknown>;
type Filter = Record<string, unknown>;
type Update = Record<string, unknown>;
interface FindOptions {
  sort?: Record<string, 1 | -1>;
  projection?: Record<string, 0 | 1>;
  skip?: number;
  limit?: number;
}

/** Callers recognise a duplicate key by MongoDB's code (`isDuplicateKey`). */
export class DuplicateKeyError extends Error {
  readonly code = 11000;
  constructor(collection: string, fields: string[]) {
    super(`E11000 duplicate key error collection: ${collection} index: ${fields.join('_')}`);
  }
}

const isPlainObject = (v: unknown): v is Doc =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/** Drops undefined fields (and turns undefined array items into null), as BSON does. */
const defined = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : defined(x)));
  if (!isPlainObject(v)) return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => [k, defined(x)]),
  );
};
const copy = <T>(v: T): T => structuredClone(defined(v)) as T;

const valueAt = (doc: Doc, path: string): unknown =>
  path.split('.').reduce<unknown>((v, key) => (isPlainObject(v) ? v[key] : undefined), doc);

/** The index keys of a document: a missing field is null, an array field gives one key per item. */
const indexKeys = (doc: Doc, fields: string[]): string[] => {
  let tuples: unknown[][] = [[]];
  for (const field of fields) {
    const value = valueAt(doc, field) ?? null;
    const items = Array.isArray(value) ? (value.length > 0 ? value : [null]) : [value];
    tuples = tuples.flatMap((t) => items.map((item) => [...t, item]));
  }
  return tuples.map((t) => encode(t));
};

const requireOperators = (update: Update): Update => {
  const keys = Object.keys(update);
  if (keys.length === 0 || keys.some((k) => !k.startsWith('$'))) {
    throw new Error('Update document requires atomic operators');
  }
  return defined(update) as Update;
};

/** The equality fields of a filter, which an upsert starts the new document from. */
const upsertBase = (filter: Filter): Doc =>
  Object.fromEntries(
    Object.entries(filter).filter(
      ([k, v]) =>
        !k.startsWith('$') && !(isPlainObject(v) && Object.keys(v).some((x) => x.startsWith('$'))),
    ),
  );

class MemoryCollection {
  docs: Doc[] = [];
  uniques: string[][] = [['_id']];

  constructor(
    private readonly name: string,
    private readonly changed: () => void,
  ) {}

  private matcher(filter: Filter = {}) {
    const query = new Query(filter, {});
    return (doc: Doc) => query.test(doc);
  }

  private select(filter: Filter = {}, { sort, projection, skip, limit }: FindOptions = {}): Doc[] {
    let cursor = find(this.docs, filter, projection);
    if (sort) cursor = cursor.sort(sort);
    if (skip) cursor = cursor.skip(skip);
    if (limit) cursor = cursor.limit(limit);
    return cursor.all().map((d) => copy(d as Doc));
  }

  /** Throws if `doc` would share a unique key with another document (`replacing` aside). */
  private checkUnique(doc: Doc, replacing?: Doc): void {
    for (const fields of this.uniques) {
      const keys = new Set(indexKeys(doc, fields));
      const clash = this.docs.some(
        (other) => other !== replacing && indexKeys(other, fields).some((k) => keys.has(k)),
      );
      if (clash) throw new DuplicateKeyError(this.name, fields);
    }
  }

  private add(doc: Doc): Doc {
    const stored = copy(doc);
    stored['_id'] ??= randomUUID();
    this.checkUnique(stored);
    this.docs.push(stored);
    this.changed();
    return stored;
  }

  /** Applies `update` to `doc`; returns the stored result, or null when nothing changed. */
  private apply(doc: Doc, update: Update): Doc | null {
    const next = copy(doc);
    if (applyUpdate(next, update).length === 0) return null;
    this.checkUnique(next, doc);
    this.docs[this.docs.indexOf(doc)] = next;
    this.changed();
    return next;
  }

  private upsert(filter: Filter, update: Update): Doc {
    const doc = copy(upsertBase(filter));
    applyUpdate(doc, update);
    return this.add(doc);
  }

  async createIndex(keys: Record<string, 1 | -1>, options: { unique?: boolean } = {}) {
    const fields = Object.keys(keys);
    const name = Object.entries(keys)
      .map(([k, v]) => `${k}_${v}`)
      .join('_');
    if (options.unique && !this.uniques.some((u) => u.join() === fields.join())) {
      this.uniques.push(fields);
      this.changed();
    }
    return name;
  }

  find(filter?: Filter, options?: FindOptions) {
    return { toArray: async () => this.select(filter, options) };
  }

  async findOne(filter?: Filter, options: FindOptions = {}) {
    return this.select(filter, { ...options, limit: 1 })[0] ?? null;
  }

  async countDocuments(filter?: Filter) {
    return this.docs.filter(this.matcher(filter)).length;
  }

  async insertOne(doc: Doc) {
    return { acknowledged: true, insertedId: this.add(doc)['_id'] };
  }

  async updateOne(filter: Filter, update: Update, options: { upsert?: boolean } = {}) {
    return this.updateWhere(filter, update, { ...options, many: false });
  }

  async updateMany(filter: Filter, update: Update, options: { upsert?: boolean } = {}) {
    return this.updateWhere(filter, update, { ...options, many: true });
  }

  private updateWhere(
    filter: Filter,
    update: Update,
    { many, upsert }: { many: boolean; upsert?: boolean },
  ) {
    const ops = requireOperators(update);
    const match = this.matcher(filter);
    const targets = many ? this.docs.filter(match) : this.docs.filter(match).slice(0, 1);
    if (targets.length === 0 && upsert) {
      const doc = this.upsert(filter, ops);
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
        upsertedId: doc['_id'],
      };
    }
    const modifiedCount = targets.filter((doc) => this.apply(doc, ops) !== null).length;
    return {
      acknowledged: true,
      matchedCount: targets.length,
      modifiedCount,
      upsertedCount: 0,
      upsertedId: null,
    };
  }

  async findOneAndUpdate(
    filter: Filter,
    update: Update,
    options: { returnDocument?: 'before' | 'after'; upsert?: boolean } = {},
  ) {
    const ops = requireOperators(update);
    const doc = this.docs.find(this.matcher(filter));
    if (!doc) {
      if (!options.upsert) return null;
      const created = this.upsert(filter, ops);
      return options.returnDocument === 'after' ? copy(created) : null;
    }
    const before = copy(doc);
    const after = this.apply(doc, ops);
    return options.returnDocument === 'after' ? copy(after ?? doc) : before;
  }

  async deleteOne(filter?: Filter) {
    return this.deleteWhere(filter, false);
  }

  async deleteMany(filter?: Filter) {
    return this.deleteWhere(filter, true);
  }

  private deleteWhere(filter: Filter | undefined, many: boolean) {
    const match = this.matcher(filter);
    const doomed = many ? this.docs.filter(match) : this.docs.filter(match).slice(0, 1);
    if (doomed.length > 0) {
      this.docs = this.docs.filter((d) => !doomed.includes(d));
      this.changed();
    }
    return { acknowledged: true, deletedCount: doomed.length };
  }
}

/** JSON with Dates and binary data kept: `{ $date }` and `{ $binary }` (base64). */
const encode = (value: unknown): string =>
  JSON.stringify(value, function (this: Doc, key: string, v: unknown) {
    const raw = this[key];
    if (raw instanceof Date) return { $date: raw.toISOString() };
    if (raw instanceof Uint8Array) return { $binary: Buffer.from(raw).toString('base64') };
    return v;
  });

const decode = (text: string): unknown =>
  JSON.parse(text, (_key, v: unknown) => {
    if (isPlainObject(v) && typeof v['$date'] === 'string') return new Date(v['$date']);
    if (isPlainObject(v) && typeof v['$binary'] === 'string') {
      return new Uint8Array(Buffer.from(v['$binary'], 'base64'));
    }
    return v;
  });

interface Snapshot {
  [collection: string]: { docs: Doc[]; uniques: string[][] };
}

export interface MemoryDatabase {
  db: Db;
  /** Writes any pending change to the file now. */
  flush: () => void;
}

const WRITE_DELAY_MS = 50;

export const createMemoryDatabase = ({ file }: { file?: string } = {}): MemoryDatabase => {
  const collections = new Map<string, MemoryCollection>();
  let pending: NodeJS.Timeout | undefined;

  const flush = () => {
    clearTimeout(pending);
    pending = undefined;
    if (!file) return;
    const snapshot: Snapshot = {};
    for (const [name, col] of collections)
      snapshot[name] = { docs: col.docs, uniques: col.uniques };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, encode(snapshot));
    renameSync(`${file}.tmp`, file);
  };
  const changed = () => {
    if (file && !pending) pending = setTimeout(flush, WRITE_DELAY_MS).unref();
  };
  const collection = (name: string) => {
    let col = collections.get(name);
    if (!col) collections.set(name, (col = new MemoryCollection(name, changed)));
    return col;
  };

  if (file && existsSync(file)) {
    for (const [name, saved] of Object.entries(decode(readFileSync(file, 'utf8')) as Snapshot)) {
      const col = collection(name);
      col.docs = saved.docs;
      col.uniques = saved.uniques;
    }
  }

  const db = {
    collection,
    command: async (cmd: Doc) => {
      if (!('ping' in cmd)) throw new Error(`Unsupported command: ${Object.keys(cmd).join()}`);
      return { ok: 1 };
    },
  };
  return { db: db as unknown as Db, flush };
};
