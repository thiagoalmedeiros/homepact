import type { Db } from 'mongodb';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { findAccessKeyByHash } from '../../src/data/access-key-lookup.js';
import {
  companiesCollection,
  findCompany,
  findMarketRate,
  marketRatesCollection,
  saveMarketRate,
} from '../../src/data/platform-repo.js';
import { accessKeyDoc } from '../support/fixtures.js';

let findOne: Mock;
let find: Mock;
let updateOne: Mock;
let db: Db & { collection: Mock };

beforeEach(() => {
  findOne = vi.fn();
  find = vi.fn();
  updateOne = vi.fn();
  db = { collection: vi.fn(() => ({ findOne, find, updateOne })) } as unknown as Db & {
    collection: Mock;
  };
});

describe('platform repository', () => {
  it('companies live in the platform-level "companies" collection', () => {
    companiesCollection(db);
    expect(db.collection).toHaveBeenCalledWith('companies');
  });

  it('findCompany looks a company up by id', async () => {
    findOne.mockResolvedValue({ _id: 'co-1', name: 'Alpha' });
    expect(await findCompany(db, 'co-1')).toEqual({ _id: 'co-1', name: 'Alpha' });
    expect(findOne).toHaveBeenCalledWith({ _id: 'co-1' });
  });
});

describe('market rates (platform-level)', () => {
  it('live in "marketRates", one document per series, upserted on refresh', async () => {
    marketRatesCollection(db);
    expect(db.collection).toHaveBeenCalledWith('marketRates');
    await findMarketRate(db, 'V1');
    expect(findOne).toHaveBeenCalledWith({ _id: 'V1' });
    const rate = {
      _id: 'V1',
      source: 'Bank of Canada',
      sourceUrl: 'https://rates.test',
      observations: [{ date: '2026-11-04', ratePercent: 6.09 }],
      fetchedAt: '2026-11-10T12:00:00.000Z',
    };
    await saveMarketRate(db, rate);
    const { _id, ...rest } = rate;
    expect(updateOne).toHaveBeenCalledWith({ _id }, { $set: rest }, { upsert: true });
  });
});

describe('access key lookup', () => {
  it('finds a key by hash across tenants (the caller checks the company)', async () => {
    findOne.mockResolvedValue(accessKeyDoc());
    expect(await findAccessKeyByHash(db, 'abc')).toEqual(accessKeyDoc());
    expect(db.collection).toHaveBeenCalledWith('accessKeys');
    expect(findOne).toHaveBeenCalledWith({ hash: 'abc' });
  });

  it('returns null for an unknown hash', async () => {
    findOne.mockResolvedValue(null);
    expect(await findAccessKeyByHash(db, 'nope')).toBeNull();
  });
});
