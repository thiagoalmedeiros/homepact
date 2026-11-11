import { InventoryStatus } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unprocessable } from '../../../src/http/errors.js';
import { loadHouse, pricingContext } from '../../../src/modules/houses/pricing.js';
import { inventoryRoutes } from '../../../src/modules/inventory/routes.js';
import { quoteInventory, toInventoryHome } from '../../../src/modules/inventory/store.js';
import { catalog, houseDoc, inventoryDoc } from '../../support/fixtures.js';
import {
  BUYER,
  COMPANY_TENANT,
  NOW_ISO,
  STAFF,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'home-new') }));
vi.mock('../../../src/modules/houses/pricing.js', () => ({
  loadHouse: vi.fn(),
  pricingContext: vi.fn(),
}));
vi.mock('../../../src/modules/inventory/store.js', () => ({
  quoteInventory: vi.fn(),
  toInventoryHome: vi.fn(),
}));

const pc = { catalog: catalog(), currency: 'CAD' as const };
const input = { houseId: 'house-1', address: '12 Main St', selections: {}, priceCents: 100 };

let h: Harness;
let repo: MockRepo;
let scene: Scene;

beforeEach(async () => {
  repo = mockRepo();
  scene = { tenant: COMPANY_TENANT, repo, principal: STAFF };
  vi.mocked(pricingContext).mockResolvedValue(pc);
  vi.mocked(loadHouse).mockResolvedValue(houseDoc());
  vi.mocked(toInventoryHome).mockImplementation(
    (d, house) => ({ home: d._id, house: house._id }) as never,
  );
  h = await serveRouter(inventoryRoutes(mockContext()), scene);
});
afterEach(() => h.close());

it('is staff-only', async () => {
  scene.principal = BUYER;
  expect((await h.call('GET', '/')).status).toBe(403);
});

it('GET / lists homes with their house, skipping homes whose house is gone', async () => {
  repo
    .col('inventoryHomes')
    .find.mockResolvedValue([
      inventoryDoc(),
      inventoryDoc({ _id: 'orphan', houseId: 'deleted-house' }),
    ]);
  repo.col('houses').find.mockResolvedValue([houseDoc()]);
  expect((await h.call('GET', '/')).body).toEqual([{ home: 'home-1', house: 'house-1' }]);
  expect(repo.col('inventoryHomes').find).toHaveBeenCalledWith(
    {},
    { sort: { status: 1, address: 1 } },
  );
  expect(toInventoryHome).toHaveBeenCalledWith(inventoryDoc(), houseDoc(), pc);
});

describe('POST /', () => {
  it('validates the configuration against the house, then stores the home', async () => {
    expect(await h.call('POST', '/', input)).toMatchObject({
      status: 201,
      body: { home: 'home-new', house: 'house-1' },
    });
    expect(loadHouse).toHaveBeenCalledWith(expect.anything(), 'house-1');
    const stored = {
      ...input,
      community: '',
      possession: '',
      features: [],
      images: [],
      lockedByDefault: true,
      status: InventoryStatus.Available,
    };
    expect(quoteInventory).toHaveBeenCalledWith(stored, houseDoc(), pc);
    expect(repo.col('inventoryHomes').insertOne).toHaveBeenCalledWith({
      _id: 'home-new',
      ...stored,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
  });

  it('refuses configurations the house does not offer (422) and bad input (400)', async () => {
    vi.mocked(quoteInventory).mockImplementationOnce(() => {
      throw unprocessable('Package is not in "Kitchen"');
    });
    expect((await h.call('POST', '/', input)).status).toBe(422);
    expect(repo.col('inventoryHomes').insertOne).not.toHaveBeenCalled();
    expect((await h.call('POST', '/', { address: 'x' })).status).toBe(400);
  });
});

describe('GET /:id', () => {
  it('reads a home with its house and pricing, or 404', async () => {
    repo.col('inventoryHomes').findOne.mockResolvedValueOnce(inventoryDoc());
    expect((await h.call('GET', '/home-1')).body).toEqual({ home: 'home-1', house: 'house-1' });
    expect(repo.col('inventoryHomes').findOne).toHaveBeenCalledWith({ _id: 'home-1' });
    expect((await h.call('GET', '/nope')).status).toBe(404);
  });
});

describe('PATCH /:id', () => {
  it('re-validates the merged configuration and sets only the sent fields', async () => {
    repo.col('inventoryHomes').findOne.mockResolvedValue(inventoryDoc());
    repo
      .col('inventoryHomes')
      .findOneAndUpdate.mockResolvedValue(inventoryDoc({ address: '9 Elm' }));
    expect((await h.call('PATCH', '/home-1', { address: '9 Elm' })).status).toBe(200);
    expect(loadHouse).toHaveBeenCalledWith(expect.anything(), 'house-1');
    expect(quoteInventory).toHaveBeenCalledWith(
      { ...inventoryDoc(), address: '9 Elm' },
      houseDoc(),
      pc,
    );
    expect(repo.col('inventoryHomes').findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'home-1' },
      { $set: { address: '9 Elm', updatedAt: NOW_ISO } },
    );
  });

  it('loads the new house when it changes', async () => {
    repo.col('inventoryHomes').findOne.mockResolvedValue(inventoryDoc());
    repo.col('inventoryHomes').findOneAndUpdate.mockResolvedValue(inventoryDoc());
    await h.call('PATCH', '/home-1', { houseId: 'house-2' });
    expect(loadHouse).toHaveBeenCalledWith(expect.anything(), 'house-2');
  });

  it('is a 404 for an unknown home and 422 for an invalid configuration', async () => {
    expect((await h.call('PATCH', '/nope', { address: 'x' })).status).toBe(404);
    repo.col('inventoryHomes').findOne.mockResolvedValue(inventoryDoc());
    vi.mocked(quoteInventory).mockImplementationOnce(() => {
      throw unprocessable('bad');
    });
    expect((await h.call('PATCH', '/home-1', { selections: {} })).status).toBe(422);
    expect(repo.col('inventoryHomes').findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /:id', () => {
  it('deletes a home without proposals', async () => {
    expect((await h.call('DELETE', '/home-1')).status).toBe(204);
    expect(repo.col('proposals').countDocuments).toHaveBeenCalledWith({
      inventoryHomeId: 'home-1',
    });
    expect(repo.col('inventoryHomes').deleteOne).toHaveBeenCalledWith({ _id: 'home-1' });
  });

  it('refuses a home with proposals (409) and an unknown home (404)', async () => {
    repo.col('proposals').countDocuments.mockResolvedValueOnce(1);
    expect(await h.call('DELETE', '/home-1')).toMatchObject({
      status: 409,
      body: { error: 'This home has proposals; mark it sold or reserved instead' },
    });
    repo.col('inventoryHomes').deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    expect((await h.call('DELETE', '/nope')).status).toBe(404);
  });
});
