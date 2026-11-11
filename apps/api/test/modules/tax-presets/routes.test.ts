import { CANADIAN_TAX_PRESETS } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listTaxPresets, taxPresetsCollection } from '../../../src/data/platform-repo.js';
import {
  addStarterPresets,
  platformTaxPresetRoutes,
  taxPresetRoutes,
  toTaxPreset,
} from '../../../src/modules/tax-presets/routes.js';
import { taxPresetDoc } from '../../support/fixtures.js';
import {
  ADMIN,
  COMPANY_TENANT,
  NOW,
  NOW_ISO,
  PLATFORM_TENANT,
  STAFF,
  SUPER_ADMIN,
  BUYER,
  mockCollection,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockCollection,
  type MockContext,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'preset-new') }));
vi.mock('../../../src/data/platform-repo.js', () => ({
  listTaxPresets: vi.fn(),
  taxPresetsCollection: vi.fn(),
}));

let presets: MockCollection;
let ctx: MockContext;

beforeEach(() => {
  presets = mockCollection(null);
  vi.mocked(taxPresetsCollection).mockReturnValue(presets as never);
  vi.mocked(listTaxPresets).mockResolvedValue([taxPresetDoc()]);
  ctx = mockContext();
});

describe('addStarterPresets', () => {
  it('adds the Canadian provinces the platform does not have yet, never twice', async () => {
    expect(await addStarterPresets(ctx.db, NOW)).toBe(CANADIAN_TAX_PRESETS.length - 1);
    const codes = presets.insertOne.mock.calls.map((c) => c[0].code);
    expect(codes).not.toContain('QC');
    expect(codes).toContain('ON');
    expect(presets.insertOne.mock.calls.find((c) => c[0].code === 'ON')![0]).toEqual({
      _id: 'preset-new',
      code: 'ON',
      name: 'Ontario',
      components: [{ label: 'HST', ratePercent: 13 }],
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });

    vi.mocked(listTaxPresets).mockResolvedValue(
      CANADIAN_TAX_PRESETS.map((p) => taxPresetDoc({ code: p.code })),
    );
    presets.insertOne.mockClear();
    expect(await addStarterPresets(ctx.db, NOW)).toBe(0);
    expect(presets.insertOne).not.toHaveBeenCalled();
  });
});

describe('platform routes (super-admin)', () => {
  let h: Harness;
  let scene: Scene;
  beforeEach(async () => {
    scene = { tenant: PLATFORM_TENANT, repo: mockRepo(null), principal: SUPER_ADMIN };
    h = await serveRouter(platformTaxPresetRoutes(ctx), scene);
  });
  afterEach(() => h.close());

  it('only the super-admin manages the suggestions', async () => {
    for (const principal of [ADMIN, STAFF]) {
      scene.principal = principal;
      expect((await h.call('GET', '/')).status).toBe(403);
      expect((await h.call('POST', '/', {})).status).toBe(403);
    }
    delete scene.principal;
    expect((await h.call('GET', '/')).status).toBe(401);
  });

  it('lists, creates, replaces and deletes suggestions', async () => {
    expect((await h.call('GET', '/')).body).toEqual([toTaxPreset(taxPresetDoc())]);

    const body = {
      code: 'on',
      name: 'Ontario',
      components: [{ label: 'HST', ratePercent: 13 }],
      note: 'New homes may qualify for a rebate.',
    };
    const created = await h.call('POST', '/', body);
    expect(created).toMatchObject({ status: 201, body: { id: 'preset-new', code: 'ON' } });
    expect(presets.insertOne).toHaveBeenCalledWith({
      _id: 'preset-new',
      ...body,
      code: 'ON',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    expect((await h.call('POST', '/', { ...body, components: [] })).status).toBe(400);

    presets.findOneAndUpdate.mockResolvedValue(taxPresetDoc({ code: 'ON' }));
    expect((await h.call('PUT', '/preset-qc', body)).status).toBe(200);
    expect(presets.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: 'preset-qc' },
      {
        $set: {
          code: 'ON',
          name: 'Ontario',
          components: body.components,
          note: body.note,
          updatedAt: NOW_ISO,
        },
      },
      { returnDocument: 'after' },
    );
    const { note: _note, ...withoutNote } = body;
    await h.call('PUT', '/preset-qc', withoutNote);
    expect(presets.findOneAndUpdate.mock.calls.at(-1)![1]).toEqual({
      $set: { code: 'ON', name: 'Ontario', components: body.components, updatedAt: NOW_ISO },
      $unset: { note: '' },
    });
    presets.findOneAndUpdate.mockResolvedValue(null);
    expect((await h.call('PUT', '/gone', body)).status).toBe(404);

    expect((await h.call('DELETE', '/preset-qc')).status).toBe(204);
    expect(presets.deleteOne).toHaveBeenCalledWith({ _id: 'preset-qc' });
    presets.deleteOne.mockResolvedValue({ deletedCount: 0 });
    expect((await h.call('DELETE', '/gone')).status).toBe(404);
  });

  it('adds the Canadian starter suggestions on request', async () => {
    const res = await h.call('POST', '/starter');
    expect(res.status).toBe(201);
    expect(presets.insertOne).toHaveBeenCalledTimes(CANADIAN_TAX_PRESETS.length - 1);
    vi.mocked(listTaxPresets).mockResolvedValue(
      CANADIAN_TAX_PRESETS.map((p) => taxPresetDoc({ code: p.code })),
    );
    expect((await h.call('POST', '/starter')).status).toBe(200);
  });
});

describe('company routes (read-only)', () => {
  let h: Harness;
  let scene: Scene;
  beforeEach(async () => {
    scene = { tenant: COMPANY_TENANT, repo: mockRepo(), principal: ADMIN };
    h = await serveRouter(taxPresetRoutes(ctx), scene);
  });
  afterEach(() => h.close());

  it("company staff read the platform's suggestions, to adopt them", async () => {
    for (const principal of [ADMIN, STAFF]) {
      scene.principal = principal;
      expect((await h.call('GET', '/')).body).toEqual([toTaxPreset(taxPresetDoc())]);
    }
    expect(listTaxPresets).toHaveBeenCalledWith(ctx.db);
    scene.principal = BUYER;
    expect((await h.call('GET', '/')).status).toBe(403);
    scene.principal = ADMIN;
    expect((await h.call('POST', '/', {})).status).toBe(404);
  });
});
