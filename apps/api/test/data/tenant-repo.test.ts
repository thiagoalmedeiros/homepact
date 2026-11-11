import { HouseStatus } from '@homepact/shared';
import type { Db } from 'mongodb';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { tenantRepo } from '../../src/data/tenant-repo.js';

interface DriverCollection {
  find: Mock;
  findOne: Mock;
  insertOne: Mock;
  updateOne: Mock;
  findOneAndUpdate: Mock;
  updateMany: Mock;
  deleteOne: Mock;
  countDocuments: Mock;
}

let col: DriverCollection;
let db: Db & { collection: Mock };
const toArray = vi.fn();

beforeEach(() => {
  toArray.mockResolvedValue([{ _id: 'a' }]);
  col = {
    find: vi.fn(() => ({ toArray })),
    findOne: vi.fn().mockResolvedValue({ _id: 'a' }),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }),
    findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'a' }),
    updateMany: vi.fn().mockResolvedValue({ matchedCount: 3, modifiedCount: 2 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: vi.fn().mockResolvedValue(7),
  };
  db = { collection: vi.fn(() => col) } as unknown as Db & { collection: Mock };
});

describe('tenantRepo (company scope)', () => {
  const repo = () => tenantRepo(db, 'co-1');

  it('exposes the bound company and opens the named collection', () => {
    const r = repo();
    r.of('houses');
    expect(r.companyId).toBe('co-1');
    expect(db.collection).toHaveBeenCalledWith('houses');
  });

  it('forces companyId into every read filter, overriding any caller value', async () => {
    const houses = repo().of('houses');
    expect(
      await houses.find({ status: HouseStatus.Draft, companyId: 'co-2' }, { limit: 5 }),
    ).toEqual([{ _id: 'a' }]);
    expect(col.find).toHaveBeenCalledWith(
      { status: HouseStatus.Draft, companyId: 'co-1' },
      { limit: 5 },
    );

    await houses.find();
    expect(col.find).toHaveBeenLastCalledWith({ companyId: 'co-1' }, undefined);

    expect(await houses.findOne({ _id: 'x' })).toEqual({ _id: 'a' });
    expect(col.findOne).toHaveBeenCalledWith({ _id: 'x', companyId: 'co-1' });

    expect(await houses.countDocuments({ status: HouseStatus.Published })).toBe(7);
    expect(col.countDocuments).toHaveBeenCalledWith({
      status: HouseStatus.Published,
      companyId: 'co-1',
    });
  });

  it('stamps the bound company on inserted documents and returns the stored document', async () => {
    const saved = await repo()
      .of('houses')
      .insertOne({ _id: 'h1', name: 'Aspen', companyId: 'co-2' } as never);
    expect(saved).toEqual({ _id: 'h1', name: 'Aspen', companyId: 'co-1' });
    expect(col.insertOne).toHaveBeenCalledWith({ _id: 'h1', name: 'Aspen', companyId: 'co-1' });
  });

  it('scopes updates and deletes and returns only the counts', async () => {
    const houses = repo().of('houses');
    expect(
      await houses.updateOne({ _id: 'x' }, { $set: { name: 'B' } }, { upsert: false }),
    ).toEqual({ matchedCount: 1, modifiedCount: 1 });
    expect(col.updateOne).toHaveBeenCalledWith(
      { _id: 'x', companyId: 'co-1' },
      { $set: { name: 'B' } },
      { upsert: false },
    );

    expect(await houses.updateMany({}, { $set: { status: HouseStatus.Draft } })).toEqual({
      modifiedCount: 2,
    });
    expect(col.updateMany).toHaveBeenCalledWith(
      { companyId: 'co-1' },
      { $set: { status: HouseStatus.Draft } },
    );

    expect(await houses.deleteOne({ _id: 'x' })).toEqual({ deletedCount: 1 });
    expect(col.deleteOne).toHaveBeenCalledWith({ _id: 'x', companyId: 'co-1' });
  });

  it('findOneAndUpdate is scoped and returns the document after the update', async () => {
    expect(
      await repo()
        .of('houses')
        .findOneAndUpdate({ _id: 'x' }, { $set: { name: 'B' } }),
    ).toEqual({ _id: 'a' });
    expect(col.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'x', companyId: 'co-1' },
      { $set: { name: 'B' } },
      { returnDocument: 'after' },
    );
  });

  it.each([
    [
      'moving a document to another company',
      { $set: { companyId: 'co-2' } },
      'companyId cannot be updated',
    ],
    ['unsetting the company', { $unset: { companyId: '' } }, 'companyId cannot be updated'],
    ['a replacement document', { name: 'B' }, 'Replacement updates are not allowed'],
    ['a pipeline update', [{ $set: { name: 'B' } }], 'Pipeline updates are not allowed'],
  ])('refuses %s before reaching the driver', async (_case, update, message) => {
    const houses = repo().of('houses');
    for (const run of [
      () => houses.updateOne({}, update as never),
      () => houses.updateMany({}, update as never),
      () => houses.findOneAndUpdate({}, update as never),
    ]) {
      await expect(async () => run()).rejects.toThrow(message);
    }
    expect(col.updateOne).not.toHaveBeenCalled();
    expect(col.updateMany).not.toHaveBeenCalled();
    expect(col.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('tenantRepo (platform scope)', () => {
  it('matches an explicit null company only, never documents missing the field', async () => {
    const users = tenantRepo(db, null).of('users');
    await users.findOne({ email: 'root@test' });
    expect(col.findOne).toHaveBeenCalledWith({
      email: 'root@test',
      companyId: { $eq: null, $exists: true },
    });
  });

  it('stores platform documents with companyId null', async () => {
    await tenantRepo(db, null)
      .of('users')
      .insertOne({ _id: 'u1' } as never);
    expect(col.insertOne).toHaveBeenCalledWith({ _id: 'u1', companyId: null });
  });
});
