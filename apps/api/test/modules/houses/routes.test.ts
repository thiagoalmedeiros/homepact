import { HouseStatus } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCatalog } from '../../../src/modules/catalog/store.js';
import {
  companyCurrency,
  loadHouse,
  price,
  pricingContext,
  pricingExtras,
} from '../../../src/modules/houses/pricing.js';
import { adminHouseRoutes } from '../../../src/modules/houses/routes.js';
import { assertOverridesInCatalog, toDetail, toHouse } from '../../../src/modules/houses/store.js';
import { unprocessable } from '../../../src/http/errors.js';
import { catalog, houseDoc, quote } from '../../support/fixtures.js';
import {
  BUYER,
  COMPANY_TENANT,
  NOW_ISO,
  STAFF,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockContext,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'house-new') }));
vi.mock('../../../src/modules/catalog/store.js', () => ({ loadCatalog: vi.fn() }));
vi.mock('../../../src/modules/houses/pricing.js', () => ({
  companyCurrency: vi.fn(),
  loadHouse: vi.fn(),
  price: vi.fn(),
  pricingContext: vi.fn(),
  pricingExtras: vi.fn(),
}));
vi.mock('../../../src/modules/houses/store.js', () => ({
  assertOverridesInCatalog: vi.fn(),
  toDetail: vi.fn(),
  toHouse: vi.fn(),
}));

const input = {
  name: 'The Aspen',
  slug: 'aspen',
  specs: { sqft: 2000, beds: 3, baths: 2 },
  basePriceCents: 50_000_000,
  priceOverrides: [{ refId: 'pkg-signature', priceCents: 1 }],
};
const pc = { catalog: catalog(), currency: 'CAD' as const };

let h: Harness;
let repo: MockRepo;
let scene: Scene;
let ctx: MockContext;

beforeEach(async () => {
  repo = mockRepo();
  ctx = mockContext();
  scene = { tenant: COMPANY_TENANT, repo, principal: STAFF };
  vi.mocked(loadCatalog).mockResolvedValue(catalog());
  vi.mocked(toHouse).mockImplementation((d) => ({ house: d._id }) as never);
  h = await serveRouter(adminHouseRoutes(ctx), scene);
});
afterEach(() => h.close());

it('is staff-only', async () => {
  scene.principal = BUYER;
  expect((await h.call('GET', '/')).status).toBe(403);
});

it('GET / lists houses by name', async () => {
  repo.col('houses').find.mockResolvedValue([houseDoc()]);
  expect((await h.call('GET', '/')).body).toEqual([{ house: 'house-1' }]);
  expect(repo.col('houses').find).toHaveBeenCalledWith({}, { sort: { name: 1 } });
});

describe('POST /', () => {
  it('creates a draft after checking overrides against the catalog', async () => {
    expect(await h.call('POST', '/', input)).toMatchObject({
      status: 201,
      body: { house: 'house-new' },
    });
    expect(assertOverridesInCatalog).toHaveBeenCalledWith(input.priceOverrides, catalog());
    expect(repo.col('houses').insertOne).toHaveBeenCalledWith({
      _id: 'house-new',
      ...input,
      style: '',
      description: '',
      communities: [],
      images: [],
      floorPlanImages: [],
      specs: { ...input.specs, garage: 0 },
      status: HouseStatus.Draft,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
  });

  it('refuses foreign overrides (422), bad input (400) and taken slugs (409)', async () => {
    vi.mocked(assertOverridesInCatalog).mockImplementationOnce(() => {
      throw unprocessable('Option x is not in the catalog');
    });
    expect((await h.call('POST', '/', input)).status).toBe(422);
    expect(repo.col('houses').insertOne).not.toHaveBeenCalled();
    expect((await h.call('POST', '/', { ...input, basePriceCents: -1 })).status).toBe(400);
    repo.col('houses').insertOne.mockRejectedValueOnce({ code: 11000 });
    expect(await h.call('POST', '/', input)).toMatchObject({
      status: 409,
      body: { error: 'A house with this slug already exists' },
    });
    repo.col('houses').insertOne.mockRejectedValueOnce(new Error('boom'));
    expect((await h.call('POST', '/', input)).status).toBe(500);
  });
});

describe('GET /:id and /:id/detail', () => {
  it('reads a house, or 404', async () => {
    repo.col('houses').findOne.mockResolvedValueOnce(houseDoc());
    expect((await h.call('GET', '/house-1')).body).toEqual({ house: 'house-1' });
    expect(repo.col('houses').findOne).toHaveBeenCalledWith({ _id: 'house-1' });
    expect((await h.call('GET', '/nope')).status).toBe(404);
  });

  it('shows every catalog option priced for the plan in the company currency', async () => {
    repo.col('houses').findOne.mockResolvedValueOnce(houseDoc());
    vi.mocked(companyCurrency).mockResolvedValue('USD');
    vi.mocked(toDetail).mockReturnValue({ detail: true } as never);
    expect((await h.call('GET', '/house-1/detail')).body).toEqual({ detail: true });
    expect(toDetail).toHaveBeenCalledWith(houseDoc(), catalog(), 'USD');
    expect((await h.call('GET', '/nope/detail')).status).toBe(404);
  });
});

describe('PATCH /:id', () => {
  it('sets only the sent fields', async () => {
    repo.col('houses').findOneAndUpdate.mockResolvedValue(houseDoc());
    expect((await h.call('PATCH', '/house-1', { name: 'Renamed' })).body).toEqual({
      house: 'house-1',
    });
    expect(assertOverridesInCatalog).not.toHaveBeenCalled();
    expect(repo.col('houses').findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'house-1' },
      { $set: { name: 'Renamed', updatedAt: NOW_ISO } },
    );
  });

  it('checks new overrides against the catalog', async () => {
    repo.col('houses').findOneAndUpdate.mockResolvedValue(houseDoc());
    await h.call('PATCH', '/house-1', { priceOverrides: input.priceOverrides });
    expect(assertOverridesInCatalog).toHaveBeenCalledWith(input.priceOverrides, catalog());
  });

  it('is a 404 for an unknown house and a 409 for a taken slug', async () => {
    expect((await h.call('PATCH', '/nope', { name: 'X' })).status).toBe(404);
    repo.col('houses').findOneAndUpdate.mockRejectedValueOnce({ code: 11000 });
    expect((await h.call('PATCH', '/house-1', { slug: 'taken' })).status).toBe(409);
    repo.col('houses').findOneAndUpdate.mockRejectedValueOnce(new Error('boom'));
    expect((await h.call('PATCH', '/house-1', { slug: 'taken' })).status).toBe(500);
  });
});

describe('publish / unpublish', () => {
  it.each([
    ['publish', HouseStatus.Published],
    ['unpublish', HouseStatus.Draft],
  ])('%s sets the status to %s', async (action, status) => {
    repo.col('houses').findOneAndUpdate.mockResolvedValueOnce(houseDoc());
    expect((await h.call('POST', `/house-1/${action}`)).status).toBe(200);
    expect(repo.col('houses').findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'house-1' },
      { $set: { status, updatedAt: NOW_ISO } },
    );
    expect((await h.call('POST', `/nope/${action}`)).status).toBe(404);
  });
});

describe('POST /:id/quote', () => {
  it('prices a configuration live, with the referral and the sales tax of the province', async () => {
    const extras = {
      tax: { code: 'ON', name: 'Ontario', components: [{ label: 'HST', ratePercent: 13 }] },
      referral: null,
    };
    vi.mocked(loadHouse).mockResolvedValue(houseDoc());
    vi.mocked(pricingContext).mockResolvedValue(pc);
    vi.mocked(pricingExtras).mockResolvedValue(extras);
    vi.mocked(price).mockReturnValue(quote({ totalCents: 42 }));
    const body = {
      selections: { kitchen: { packageId: 'pkg-signature' } },
      adjustments: [{ label: 'Promo', amountCents: -5 }],
      taxRegion: 'on',
      referral: { programId: 'prog-1', referrerName: 'Jo Homeowner' },
    };
    expect((await h.call('POST', '/house-1/quote', body)).body).toEqual(quote({ totalCents: 42 }));
    expect(loadHouse).toHaveBeenCalledWith(expect.anything(), 'house-1');
    expect(pricingContext).toHaveBeenCalledWith(ctx, expect.anything());
    expect(pricingExtras).toHaveBeenCalledWith(expect.anything(), {
      ...body,
      taxRegion: 'ON',
    });
    expect(price).toHaveBeenCalledWith(houseDoc(), pc, body.selections, body.adjustments, extras);
    expect((await h.call('POST', '/house-1/quote', { selections: 'x' })).status).toBe(400);
  });
});

describe('DELETE /:id', () => {
  it('deletes an unused draft', async () => {
    expect((await h.call('DELETE', '/house-1')).status).toBe(204);
    expect(repo.col('proposals').countDocuments).toHaveBeenCalledWith({ houseId: 'house-1' });
    expect(repo.col('inventoryHomes').countDocuments).toHaveBeenCalledWith({ houseId: 'house-1' });
    expect(repo.col('houses').deleteOne).toHaveBeenCalledWith({
      _id: 'house-1',
      status: HouseStatus.Draft,
    });
  });

  it('refuses a model used by proposals or homes, or that is not a draft', async () => {
    repo.col('proposals').countDocuments.mockResolvedValueOnce(1);
    expect(await h.call('DELETE', '/house-1')).toMatchObject({
      status: 409,
      body: { error: 'This model is used by proposals or homes' },
    });
    repo.col('inventoryHomes').countDocuments.mockResolvedValueOnce(1);
    expect((await h.call('DELETE', '/house-1')).status).toBe(409);
    expect(repo.col('houses').deleteOne).not.toHaveBeenCalled();
    repo.col('houses').deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    expect(await h.call('DELETE', '/house-1')).toMatchObject({
      status: 409,
      body: { error: 'Only existing draft houses can be deleted' },
    });
  });
});
