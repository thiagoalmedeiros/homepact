import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { ensureIndexes } from '../../src/data/indexes.js';
import { runMigrations } from '../../src/data/migrations.js';

describe('ensureIndexes', () => {
  const run = async () => {
    const created: { name: string; keys: Record<string, number>; options?: object }[] = [];
    const db = {
      collection: vi.fn((name: string) => ({
        createIndex: vi.fn(async (keys: Record<string, number>, options?: object) => {
          created.push({ name, keys, ...(options && { options }) });
          return 'idx';
        }),
      })),
    } as unknown as Db;
    await ensureIndexes(db);
    return created;
  };

  it('backs tenant isolation and versioning with unique indexes', async () => {
    const created = await run();
    const unique = (name: string, keys: Record<string, number>) =>
      expect(created).toContainEqual({ name, keys, options: { unique: true } });
    unique('companies', { origins: 1 });
    unique('companies', { slug: 1 });
    unique('users', { companyId: 1, email: 1 });
    unique('refreshTokens', { companyId: 1, hash: 1 });
    unique('houses', { companyId: 1, slug: 1 });
    unique('revisions', { companyId: 1, proposalId: 1, number: 1 });
    unique('accessKeys', { hash: 1 });
    unique('agreementTemplates', { companyId: 1, name: 1 });
    unique('taxRates', { companyId: 1, code: 1 });
  });

  it('expires refresh tokens with a TTL index', async () => {
    expect(await run()).toContainEqual({
      name: 'refreshTokens',
      keys: { expiresAt: 1 },
      options: { expireAfterSeconds: 0 },
    });
  });

  it('leads every tenant index with companyId', async () => {
    const platformLevel = new Set([
      'companies',
      'taxPresets',
      'accessKeys:hash',
      'refreshTokens:expiresAt',
    ]);
    for (const { name, keys } of await run()) {
      const first = Object.keys(keys)[0]!;
      if (platformLevel.has(name) || platformLevel.has(`${name}:${first}`)) continue;
      expect(first, `${name} index ${JSON.stringify(keys)}`).toBe('companyId');
    }
  });

  it('fails when the database refuses an index', async () => {
    const db = {
      collection: () => ({ createIndex: vi.fn().mockRejectedValue(new Error('not primary')) }),
    } as unknown as Db;
    await expect(ensureIndexes(db)).rejects.toThrow('not primary');
  });
});

describe('runMigrations', () => {
  const mockHouses = (legacy: object[]) => {
    const houses = {
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(legacy) })),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const db = { collection: vi.fn(() => houses) } as unknown as Db;
    return { db, houses };
  };

  it('turns legacy per-plan offers into price overrides, keeping only custom prices', async () => {
    const { db, houses } = mockHouses([
      {
        _id: 'h1',
        offers: [
          {
            packages: [{ packageId: 'p1', priceCents: 100 }, { packageId: 'p2' }],
            items: [{ itemId: 'i1', priceCents: 0 }, { itemId: 'i2' }],
          },
          { packages: [{ packageId: 'p3', priceCents: 300 }] },
        ],
      },
    ]);
    await runMigrations(db);
    expect(houses.find).toHaveBeenCalledWith({ offers: { $exists: true } });
    expect(houses.updateOne).toHaveBeenCalledWith(
      { _id: 'h1' },
      {
        $set: {
          priceOverrides: [
            { refId: 'p1', priceCents: 100 },
            { refId: 'i1', priceCents: 0 },
            { refId: 'p3', priceCents: 300 },
          ],
        },
        $unset: { offers: '' },
      },
    );
  });

  it('handles empty offer lists', async () => {
    const { db, houses } = mockHouses([{ _id: 'h2', offers: [{}] }]);
    await runMigrations(db);
    expect(houses.updateOne).toHaveBeenCalledWith(
      { _id: 'h2' },
      { $set: { priceOverrides: [] }, $unset: { offers: '' } },
    );
  });

  it('does nothing once no legacy house is left (idempotent)', async () => {
    const { db, houses } = mockHouses([]);
    await runMigrations(db);
    expect(houses.updateOne).not.toHaveBeenCalled();
  });
});
