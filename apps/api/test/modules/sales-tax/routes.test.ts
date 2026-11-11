import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTaxPreset } from '../../../src/data/platform-repo.js';
import { taxRateRoutes } from '../../../src/modules/sales-tax/routes.js';
import { toTaxRate } from '../../../src/modules/sales-tax/store.js';
import { taxPresetDoc, taxRateDoc } from '../../support/fixtures.js';
import {
  ADMIN,
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

vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'tax-new') }));
vi.mock('../../../src/data/platform-repo.js', () => ({ findTaxPreset: vi.fn() }));

let h: Harness;
let repo: MockRepo;
let scene: Scene;
let ctx: MockContext;
const rates = () => repo.col('taxRates');
const quebec = {
  code: 'qc',
  name: 'Quebec',
  components: [
    { label: 'GST', ratePercent: 5 },
    { label: 'QST', ratePercent: 9.975 },
  ],
};

beforeEach(async () => {
  repo = mockRepo();
  ctx = mockContext();
  scene = { tenant: COMPANY_TENANT, repo, principal: ADMIN };
  h = await serveRouter(taxRateRoutes(ctx), scene);
});
afterEach(() => h.close());

describe('access', () => {
  it('is for signed-in company staff only', async () => {
    delete scene.principal;
    expect((await h.call('GET', '/')).status).toBe(401);
    scene.principal = BUYER;
    expect((await h.call('GET', '/')).status).toBe(403);
  });

  it('sales staff read the provinces; only administrators change them', async () => {
    scene.principal = STAFF;
    rates().find.mockResolvedValue([taxRateDoc()]);
    expect((await h.call('GET', '/')).body).toEqual([toTaxRate(taxRateDoc())]);
    expect(rates().find).toHaveBeenCalledWith({}, { sort: { name: 1 } });
    for (const [method, path] of [
      ['POST', '/'],
      ['POST', '/adopt'],
      ['PUT', '/tax-on'],
      ['DELETE', '/tax-on'],
    ] as const) {
      expect((await h.call(method, path, quebec)).status, `${method} ${path}`).toBe(403);
    }
    expect(rates().insertOne).not.toHaveBeenCalled();
    expect(rates().deleteOne).not.toHaveBeenCalled();
  });
});

describe('POST / (an administrator enters their own rates)', () => {
  it('stores the province with its taxes; the first one becomes the default', async () => {
    const res = await h.call('POST', '/', quebec);
    expect(res.status).toBe(201);
    expect(rates().insertOne).toHaveBeenCalledWith({
      _id: 'tax-new',
      code: 'QC',
      name: 'Quebec',
      components: quebec.components,
      isDefault: true,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    expect(rates().updateMany).toHaveBeenCalledWith(
      { _id: { $ne: 'tax-new' }, isDefault: true },
      { $set: { isDefault: false } },
    );
    expect(res.body).toMatchObject({ id: 'tax-new', code: 'QC', isDefault: true });
  });

  it('later ones are not the default unless asked', async () => {
    rates().countDocuments.mockResolvedValue(1);
    await h.call('POST', '/', quebec);
    expect(rates().insertOne.mock.calls[0]![0]).toMatchObject({ isDefault: false });
    expect(rates().updateMany).not.toHaveBeenCalled();
    await h.call('POST', '/', { ...quebec, isDefault: true });
    expect(rates().insertOne.mock.calls[1]![0]).toMatchObject({ isDefault: true });
    expect(rates().updateMany).toHaveBeenCalled();
  });

  it('refuses invalid rates (400) and a province the company already has (409)', async () => {
    expect(
      (
        await h.call('POST', '/', {
          ...quebec,
          components: [{ label: 'QST', ratePercent: 9.9751 }],
        })
      ).status,
    ).toBe(400);
    expect((await h.call('POST', '/', { ...quebec, components: [] })).status).toBe(400);
    rates().insertOne.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    expect(await h.call('POST', '/', quebec)).toMatchObject({
      status: 409,
      body: { error: 'Your company already has a sales tax for QC' },
    });
  });
});

describe('POST /adopt (an administrator uses a suggestion of the platform)', () => {
  it('copies the suggestion into the company, remembering where it came from', async () => {
    vi.mocked(findTaxPreset).mockResolvedValue(taxPresetDoc({ note: 'Guidance' }));
    rates().countDocuments.mockResolvedValue(2);
    const res = await h.call('POST', '/adopt', { presetId: 'preset-qc', isDefault: true });
    expect(res.status).toBe(201);
    expect(findTaxPreset).toHaveBeenCalledWith(ctx.db, 'preset-qc');
    expect(rates().insertOne).toHaveBeenCalledWith({
      _id: 'tax-new',
      code: 'QC',
      name: 'Quebec',
      components: taxPresetDoc().components,
      presetId: 'preset-qc',
      isDefault: true,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
  });

  it('is a 404 for a suggestion that is gone and a 409 for a province already there', async () => {
    vi.mocked(findTaxPreset).mockResolvedValue(null);
    expect(await h.call('POST', '/adopt', { presetId: 'gone' })).toMatchObject({
      status: 404,
      body: { error: 'This sales tax suggestion no longer exists' },
    });
    vi.mocked(findTaxPreset).mockResolvedValue(taxPresetDoc());
    rates().insertOne.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    expect((await h.call('POST', '/adopt', { presetId: 'preset-qc' })).status).toBe(409);
    expect((await h.call('POST', '/adopt', {})).status).toBe(400);
  });
});

describe('PUT /:id', () => {
  it('replaces the rates; making it the default demotes the others', async () => {
    rates().findOneAndUpdate.mockResolvedValue(taxRateDoc({ code: 'QC', isDefault: true }));
    const res = await h.call('PUT', '/tax-on', { ...quebec, isDefault: true });
    expect(res.status).toBe(200);
    expect(rates().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'tax-on' },
      {
        $set: {
          code: 'QC',
          name: 'Quebec',
          components: quebec.components,
          isDefault: true,
          updatedAt: NOW_ISO,
        },
      },
    );
    expect(rates().updateMany).toHaveBeenCalledWith(
      { _id: { $ne: 'tax-on' }, isDefault: true },
      { $set: { isDefault: false } },
    );
  });

  it('is a 404 for another company’s rate and a 409 for a taken province', async () => {
    expect((await h.call('PUT', '/elsewhere', quebec)).status).toBe(404);
    rates().findOneAndUpdate.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    expect((await h.call('PUT', '/tax-on', quebec)).status).toBe(409);
  });
});

describe('DELETE /:id', () => {
  it('removing the default makes another province the default', async () => {
    rates().findOne.mockResolvedValue(taxRateDoc());
    rates().find.mockResolvedValue([taxRateDoc({ _id: 'tax-ab', code: 'AB', isDefault: false })]);
    expect((await h.call('DELETE', '/tax-on')).status).toBe(204);
    expect(rates().deleteOne).toHaveBeenCalledWith({ _id: 'tax-on' });
    expect(rates().find).toHaveBeenCalledWith({}, { sort: { name: 1 }, limit: 1 });
    expect(rates().updateOne).toHaveBeenCalledWith(
      { _id: 'tax-ab' },
      { $set: { isDefault: true } },
    );
  });

  it('removing another one changes nothing else; an unknown one is a 404', async () => {
    rates().findOne.mockResolvedValueOnce(taxRateDoc({ isDefault: false }));
    expect((await h.call('DELETE', '/tax-on')).status).toBe(204);
    expect(rates().updateOne).not.toHaveBeenCalled();
    expect((await h.call('DELETE', '/nope')).status).toBe(404);
  });
});
