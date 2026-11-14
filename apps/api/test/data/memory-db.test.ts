import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDatabase, DuplicateKeyError } from '../../src/data/memory-db.js';
import { tenantRepo } from '../../src/data/tenant-repo.js';
import { isDuplicateKey } from '../../src/http/errors.js';

/** Documents with string ids, as the app stores them. */
interface TestDoc {
  _id: string;
  [field: string]: unknown;
}
const collectionOf = (db: Db, name: string) => db.collection<TestDoc>(name);

describe('in-memory database', () => {
  let db: Db;

  beforeEach(() => {
    db = createMemoryDatabase().db;
  });

  it('finds with filters, sort, projection, skip and limit, and returns copies', async () => {
    const col = collectionOf(db, 'houses');
    await col.insertOne({ _id: 'h1', name: 'Birch', status: 'active', tags: ['a', 'b'] });
    await col.insertOne({ _id: 'h2', name: 'Aspen', status: 'active', tags: ['c'] });
    await col.insertOne({ _id: 'h3', name: 'Cedar', status: 'retired' });

    const active = await col.find({ status: 'active' }, { sort: { name: 1 } }).toArray();
    expect(active.map((h) => h['name'])).toEqual(['Aspen', 'Birch']);
    expect(await col.find({ tags: 'b' }).toArray()).toHaveLength(1);
    expect(await col.find({ status: { $in: ['retired'] } }).toArray()).toHaveLength(1);
    expect(await col.find({ status: { $ne: 'active' } }).toArray()).toHaveLength(1);
    expect(
      await col
        .find({}, { sort: { name: -1 }, skip: 1, limit: 1, projection: { _id: 1 } })
        .toArray(),
    ).toEqual([{ _id: 'h1' }]);
    expect(await col.findOne({ _id: 'missing' })).toBeNull();
    expect(await col.countDocuments({ status: 'active' })).toBe(2);

    const found = await col.findOne({ _id: 'h1' });
    found!['name'] = 'changed';
    expect((await col.findOne({ _id: 'h1' }))!['name']).toBe('Birch');
  });

  it('drops undefined fields like the driver with ignoreUndefined, and keeps Dates and bytes', async () => {
    const col = collectionOf(db, 'files');
    const at = new Date('2026-01-02T03:04:05Z');
    await col.insertOne({ _id: 'f1', note: undefined, at, data: Buffer.from('pdf') });
    const doc = await col.findOne({ _id: 'f1' });
    expect(doc).not.toHaveProperty('note');
    expect(doc!['at']).toEqual(at);
    expect(Buffer.from(doc!['data'] as Uint8Array).toString()).toBe('pdf');
  });

  it('applies update operators and reports matched and modified counts', async () => {
    const col = db.collection<{
      _id: string;
      status?: string;
      n?: number;
      ids?: string[];
      note?: string;
      buyer?: { name: string };
      seen?: boolean;
    }>('proposals');
    await col.insertOne({ _id: 'p1', status: 'open', n: 1, ids: ['a', 'b'], note: 'x' });
    await col.insertOne({ _id: 'p2', status: 'open', n: 1, ids: [] });

    expect(
      await col.updateOne(
        { _id: 'p1' },
        {
          $set: { status: 'signed', 'buyer.name': 'Sam' },
          $unset: { note: '' },
          $inc: { n: 2 },
          $pull: { ids: 'a' },
        },
      ),
    ).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
    expect(await col.findOne({ _id: 'p1' })).toEqual({
      _id: 'p1',
      status: 'signed',
      n: 3,
      ids: ['b'],
      buyer: { name: 'Sam' },
    });
    expect(await col.updateOne({ _id: 'p1' }, { $set: { status: 'signed' } })).toMatchObject({
      matchedCount: 1,
      modifiedCount: 0,
    });
    expect(
      await col.updateMany({ status: { $exists: true } }, { $set: { seen: true } }),
    ).toMatchObject({ matchedCount: 2, modifiedCount: 2 });
    await expect(col.updateOne({ _id: 'p1' }, { status: 'x' } as never)).rejects.toThrow(
      'atomic operators',
    );
  });

  it('upserts from the filter equality fields', async () => {
    const col = collectionOf(db, 'marketRates');
    const r = await col.updateOne({ _id: 'cad' }, { $set: { rate: 5 } }, { upsert: true });
    expect(r).toMatchObject({ matchedCount: 0, upsertedCount: 1, upsertedId: 'cad' });
    expect(await col.findOne({ _id: 'cad' })).toEqual({ _id: 'cad', rate: 5 });
  });

  it('findOneAndUpdate returns the document before or after the change', async () => {
    const col = collectionOf(db, 'agreements');
    await col.insertOne({ _id: 'a1', status: 'draft' });
    expect(await col.findOneAndUpdate({ _id: 'a1' }, { $set: { status: 'issued' } })).toEqual({
      _id: 'a1',
      status: 'draft',
    });
    expect(
      await col.findOneAndUpdate(
        { _id: 'a1', status: 'issued' },
        { $set: { status: 'signed' } },
        { returnDocument: 'after' },
      ),
    ).toEqual({ _id: 'a1', status: 'signed' });
    expect(
      await col.findOneAndUpdate({ _id: 'a1', status: 'draft' }, { $set: { status: 'void' } }),
    ).toBeNull();
  });

  it('deletes one or many documents', async () => {
    const col = collectionOf(db, 'accessKeys');
    for (const _id of ['k1', 'k2', 'k3']) await col.insertOne({ _id, kind: 'invite' });
    expect(await col.deleteOne({ kind: 'invite' })).toMatchObject({ deletedCount: 1 });
    expect(await col.deleteMany({ kind: 'invite' })).toMatchObject({ deletedCount: 2 });
    expect(await col.deleteOne({ kind: 'invite' })).toMatchObject({ deletedCount: 0 });
  });

  it('enforces unique indexes, compound and multikey, with MongoDB duplicate-key code', async () => {
    const users = collectionOf(db, 'users');
    await users.createIndex({ companyId: 1, email: 1 }, { unique: true });
    await users.insertOne({ _id: 'u1', companyId: 'c1', email: 'a@x' });
    await users.insertOne({ _id: 'u2', companyId: 'c2', email: 'a@x' });
    const dup = await users.insertOne({ _id: 'u3', companyId: 'c1', email: 'a@x' }).catch((e) => e);
    expect(dup).toBeInstanceOf(DuplicateKeyError);
    expect(isDuplicateKey(dup)).toBe(true);
    await expect(users.insertOne({ _id: 'u1', companyId: 'c9', email: 'z@x' })).rejects.toThrow(
      'E11000',
    );
    await expect(
      users.updateOne({ _id: 'u2' }, { $set: { companyId: 'c1' } }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    expect(await users.findOne({ _id: 'u2' })).toMatchObject({ companyId: 'c2' });

    const companies = collectionOf(db, 'companies');
    await companies.createIndex({ origins: 1 }, { unique: true });
    await companies.insertOne({ _id: 'c1', origins: ['http://a', 'http://b'] });
    await expect(
      companies.insertOne({ _id: 'c2', origins: ['http://c', 'http://b'] }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('answers ping and refuses other commands', async () => {
    await expect(db.command({ ping: 1 })).resolves.toEqual({ ok: 1 });
    await expect(db.command({ dropDatabase: 1 })).rejects.toThrow('Unsupported command');
  });

  it('keeps tenant scoping intact through the tenant repository', async () => {
    const companyUsers = tenantRepo(db, 'c1').of('users');
    const platformUsers = tenantRepo(db, null).of('users');
    await companyUsers.insertOne({ _id: 'u1' });
    await platformUsers.insertOne({ _id: 'admin' });
    await collectionOf(db, 'users').insertOne({ _id: 'legacy' });
    expect(await companyUsers.find()).toEqual([{ _id: 'u1', companyId: 'c1' }]);
    expect(await platformUsers.find()).toEqual([{ _id: 'admin', companyId: null }]);
    expect(await tenantRepo(db, 'c2').of('users').countDocuments()).toBe(0);
  });
});

describe('in-memory database kept in a file', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'homepact-memory-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes changes to the file and loads them, indexes included, in a new instance', async () => {
    const file = join(dir, 'data', 'db.json');
    const first = createMemoryDatabase({ file });
    await collectionOf(first.db, 'users').createIndex({ email: 1 }, { unique: true });
    await collectionOf(first.db, 'users').insertOne({
      _id: 'u1',
      email: 'a@x',
      at: new Date(5),
      data: Buffer.from('hi'),
    });
    first.flush();
    expect(readFileSync(file, 'utf8')).toContain('"$date"');

    const second = createMemoryDatabase({ file });
    const doc = await collectionOf(second.db, 'users').findOne({ _id: 'u1' });
    expect(doc!['at']).toEqual(new Date(5));
    expect(Buffer.from(doc!['data'] as Uint8Array).toString()).toBe('hi');
    await expect(
      collectionOf(second.db, 'users').insertOne({ _id: 'u2', email: 'a@x' }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('writes on its own shortly after a change', async () => {
    const file = join(dir, 'db.json');
    const memory = createMemoryDatabase({ file });
    await collectionOf(memory.db, 'areas').insertOne({ _id: 'a1' });
    await new Promise((r) => setTimeout(r, 120));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      areas: { docs: [{ _id: 'a1' }] },
    });
  });
});
