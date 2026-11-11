import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoutes } from '../../../src/modules/catalog/routes.js';
import { loadCatalog, toArea, toItem, toPackage } from '../../../src/modules/catalog/store.js';
import { areaDoc, catalog, inventoryDoc, itemDoc, packageDoc } from '../../support/fixtures.js';
import {
  BUYER,
  COMPANY_TENANT,
  STAFF,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'new-id') }));
vi.mock('../../../src/modules/catalog/store.js', () => ({
  loadCatalog: vi.fn(),
  toArea: vi.fn(),
  toItem: vi.fn(),
  toPackage: vi.fn(),
}));

let h: Harness;
let repo: MockRepo;
let scene: Scene;

beforeEach(async () => {
  repo = mockRepo();
  scene = { tenant: COMPANY_TENANT, repo, principal: STAFF };
  vi.mocked(toArea).mockImplementation((d) => ({ area: d.slug }) as never);
  vi.mocked(toItem).mockImplementation((d) => ({ item: d._id }) as never);
  vi.mocked(toPackage).mockImplementation((d) => ({ package: d._id }) as never);
  repo.col('areas').findOne.mockResolvedValue(areaDoc());
  h = await serveRouter(catalogRoutes(mockContext()), scene);
});
afterEach(() => h.close());

it('is staff-only', async () => {
  scene.principal = BUYER;
  expect((await h.call('GET', '/')).status).toBe(403);
});

it('GET / returns the catalog', async () => {
  vi.mocked(loadCatalog).mockResolvedValue(catalog());
  expect((await h.call('GET', '/')).body).toEqual(catalog());
  expect(loadCatalog).toHaveBeenCalledWith(repo);
});

describe('areas', () => {
  const area = { slug: 'patio', label: 'Patio' };

  it('creates an area (order defaults to 0); a taken slug is a 409', async () => {
    expect(await h.call('POST', '/areas', area)).toMatchObject({
      status: 201,
      body: { area: 'patio' },
    });
    expect(repo.col('areas').insertOne).toHaveBeenCalledWith({ _id: 'new-id', ...area, order: 0 });
    repo.col('areas').insertOne.mockRejectedValueOnce({ code: 11000 });
    expect((await h.call('POST', '/areas', area)).status).toBe(409);
    repo.col('areas').insertOne.mockRejectedValueOnce(new Error('boom'));
    expect((await h.call('POST', '/areas', area)).status).toBe(500);
    expect((await h.call('POST', '/areas', { slug: 'Bad Slug', label: 'x' })).status).toBe(400);
  });

  it('renames an area by slug, or 404', async () => {
    repo.col('areas').findOneAndUpdate.mockResolvedValueOnce(areaDoc({ label: 'Cook' }));
    expect((await h.call('PUT', '/areas/kitchen', { label: 'Cook', order: 2 })).body).toEqual({
      area: 'kitchen',
    });
    expect(repo.col('areas').findOneAndUpdate).toHaveBeenCalledWith(
      { slug: 'kitchen' },
      { $set: { label: 'Cook', order: 2 } },
    );
    expect((await h.call('PUT', '/areas/nope', { label: 'X' })).status).toBe(404);
  });

  it('deletes only an empty area', async () => {
    repo.col('catalogItems').countDocuments.mockResolvedValueOnce(1);
    expect(await h.call('DELETE', '/areas/kitchen')).toMatchObject({
      status: 409,
      body: { error: 'Remove the items and packages of this area first' },
    });
    repo.col('packages').countDocuments.mockResolvedValueOnce(2);
    expect((await h.call('DELETE', '/areas/kitchen')).status).toBe(409);
    expect(repo.col('areas').deleteOne).not.toHaveBeenCalled();

    expect((await h.call('DELETE', '/areas/kitchen')).status).toBe(204);
    expect(repo.col('areas').deleteOne).toHaveBeenCalledWith({ slug: 'kitchen' });
    repo.col('areas').deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    expect((await h.call('DELETE', '/areas/nope')).status).toBe(404);
  });
});

describe('items', () => {
  const item = { areaSlug: 'kitchen', name: 'Island', priceCents: 500_000 };

  it('creates an item in an existing area with integer-cent prices', async () => {
    expect(await h.call('POST', '/items', item)).toMatchObject({
      status: 201,
      body: { item: 'new-id' },
    });
    expect(repo.col('areas').findOne).toHaveBeenCalledWith({ slug: 'kitchen' });
    expect(repo.col('catalogItems').insertOne).toHaveBeenCalledWith({
      _id: 'new-id',
      ...item,
      soldSeparately: true,
    });
    expect((await h.call('POST', '/items', { ...item, priceCents: 1.5 })).status).toBe(400);
  });

  it('an unknown area is a 422', async () => {
    repo.col('areas').findOne.mockResolvedValue(null);
    expect(await h.call('POST', '/items', item)).toMatchObject({
      status: 422,
      body: { error: 'Unknown area "kitchen"' },
    });
    expect((await h.call('PATCH', '/items/item-island', { areaSlug: 'patio' })).status).toBe(422);
  });

  it('patches only the sent fields, or 404', async () => {
    repo.col('catalogItems').findOneAndUpdate.mockResolvedValueOnce(itemDoc());
    expect((await h.call('PATCH', '/items/item-island', { priceCents: 1 })).body).toEqual({
      item: 'item-island',
    });
    expect(repo.col('areas').findOne).not.toHaveBeenCalled();
    expect(repo.col('catalogItems').findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'item-island' },
      { $set: { priceCents: 1 } },
    );
    expect((await h.call('PATCH', '/items/nope', { priceCents: 1 })).status).toBe(404);
  });

  it('refuses to delete an item used by a package or a pre-existing home', async () => {
    repo.col('packages').countDocuments.mockResolvedValueOnce(1);
    expect(await h.call('DELETE', '/items/item-hood')).toMatchObject({
      status: 409,
      body: { error: 'Item is part of a package; remove it from the package first' },
    });
    expect(repo.col('packages').countDocuments).toHaveBeenCalledWith({ itemIds: 'item-hood' });

    repo
      .col('inventoryHomes')
      .find.mockResolvedValueOnce([
        inventoryDoc({ selections: { kitchen: { itemIds: ['item-hood'] } } }),
      ]);
    expect(await h.call('DELETE', '/items/item-hood')).toMatchObject({
      status: 409,
      body: { error: 'A pre-existing home is built with this option' },
    });
    expect(repo.col('catalogItems').deleteOne).not.toHaveBeenCalled();
  });

  it('deletes an unused item and drops plan price overrides for it', async () => {
    repo.col('inventoryHomes').find.mockResolvedValueOnce([inventoryDoc()]);
    expect((await h.call('DELETE', '/items/item-oak')).status).toBe(204);
    expect(repo.col('catalogItems').deleteOne).toHaveBeenCalledWith({ _id: 'item-oak' });
    expect(repo.col('houses').updateMany).toHaveBeenCalledWith(
      {},
      { $pull: { priceOverrides: { refId: 'item-oak' } } },
    );
    repo.col('catalogItems').deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    expect((await h.call('DELETE', '/items/nope')).status).toBe(404);
  });
});

describe('packages', () => {
  const pkg = { areaSlug: 'kitchen', name: 'Signature', itemIds: ['a', 'b', 'a'], priceCents: 9 };

  it('creates a package of de-duplicated items from its own area', async () => {
    repo.col('catalogItems').countDocuments.mockResolvedValue(2);
    expect(await h.call('POST', '/packages', pkg)).toMatchObject({
      status: 201,
      body: { package: 'new-id' },
    });
    expect(repo.col('catalogItems').countDocuments).toHaveBeenCalledWith({
      _id: { $in: ['a', 'b'] },
      areaSlug: 'kitchen',
    });
    expect(repo.col('packages').insertOne).toHaveBeenCalledWith({
      _id: 'new-id',
      ...pkg,
      itemIds: ['a', 'b'],
    });
  });

  it('refuses items from another area (422)', async () => {
    repo.col('catalogItems').countDocuments.mockResolvedValue(1);
    expect(await h.call('POST', '/packages', pkg)).toMatchObject({
      status: 422,
      body: { error: 'Package items must belong to the package area' },
    });
    expect(repo.col('packages').insertOne).not.toHaveBeenCalled();
  });

  it('patches a package, re-checking its items against the (new) area', async () => {
    repo.col('packages').findOne.mockResolvedValue(packageDoc());
    repo.col('packages').findOneAndUpdate.mockResolvedValue(packageDoc());
    repo.col('catalogItems').countDocuments.mockResolvedValue(2);
    expect((await h.call('PATCH', '/packages/pkg-signature', { name: 'Sig' })).body).toEqual({
      package: 'pkg-signature',
    });
    expect(repo.col('areas').findOne).not.toHaveBeenCalled();
    expect(repo.col('catalogItems').countDocuments).toHaveBeenCalledWith({
      _id: { $in: ['item-island', 'item-hood'] },
      areaSlug: 'kitchen',
    });
    expect(repo.col('packages').findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'pkg-signature' },
      { $set: { name: 'Sig' } },
    );

    repo.col('catalogItems').countDocuments.mockResolvedValue(1);
    await h.call('PATCH', '/packages/pkg-signature', { areaSlug: 'flooring', itemIds: ['x'] });
    expect(repo.col('areas').findOne).toHaveBeenCalledWith({ slug: 'flooring' });
    expect(repo.col('catalogItems').countDocuments).toHaveBeenLastCalledWith({
      _id: { $in: ['x'] },
      areaSlug: 'flooring',
    });
  });

  it('patching an unknown package is a 404', async () => {
    expect((await h.call('PATCH', '/packages/nope', { name: 'X' })).status).toBe(404);
  });

  it('refuses to delete a package a pre-existing home is built with', async () => {
    repo.col('inventoryHomes').find.mockResolvedValue([inventoryDoc()]);
    expect((await h.call('DELETE', '/packages/pkg-signature')).status).toBe(409);
    expect(repo.col('packages').deleteOne).not.toHaveBeenCalled();
  });

  it('deletes an unused package and its price overrides', async () => {
    expect((await h.call('DELETE', '/packages/pkg-standard')).status).toBe(204);
    expect(repo.col('houses').updateMany).toHaveBeenCalledWith(
      {},
      { $pull: { priceOverrides: { refId: 'pkg-standard' } } },
    );
    repo.col('packages').deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    expect((await h.call('DELETE', '/packages/nope')).status).toBe(404);
  });
});
