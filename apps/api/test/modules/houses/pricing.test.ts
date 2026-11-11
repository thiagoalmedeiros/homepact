import { QuoteError } from '@homepact/shared';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findCompany } from '../../../src/data/platform-repo.js';
import { loadCatalog } from '../../../src/modules/catalog/store.js';
import {
  ASKING_PRICE_LABEL,
  askingPriceAdjustment,
  companyCurrency,
  loadHouse,
  price,
  pricingContext,
  pricingExtras,
} from '../../../src/modules/houses/pricing.js';
import { applyReferral } from '../../../src/modules/referrals/store.js';
import { resolveTaxRate } from '../../../src/modules/sales-tax/store.js';
import { catalog, houseDoc, quote } from '../../support/fixtures.js';
import {
  COMPANY_ID,
  COMPANY_TENANT,
  PLATFORM_TENANT,
  mockContext,
  mockRepo,
  type MockRepo,
} from '../../support/mocks.js';

vi.mock('../../../src/data/platform-repo.js', () => ({ findCompany: vi.fn() }));
vi.mock('../../../src/modules/catalog/store.js', () => ({ loadCatalog: vi.fn() }));
vi.mock('../../../src/modules/referrals/store.js', () => ({ applyReferral: vi.fn() }));
vi.mock('../../../src/modules/sales-tax/store.js', () => ({ resolveTaxRate: vi.fn() }));
vi.mock('@homepact/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@homepact/shared')>()),
  computeQuote: vi.fn(),
}));
const { computeQuote } = await import('@homepact/shared');

let repo: MockRepo;
const ctx = mockContext();
const request = (tenant = COMPANY_TENANT) => ({ tenant, repo }) as unknown as Request;

beforeEach(() => {
  repo = mockRepo();
});

describe('companyCurrency', () => {
  it("reads the Origin company's currency", async () => {
    vi.mocked(findCompany).mockResolvedValue({ currency: 'USD' } as never);
    expect(await companyCurrency(ctx, request())).toBe('USD');
    expect(findCompany).toHaveBeenCalledWith(ctx.db, COMPANY_ID);
  });

  it('defaults to CAD when the company is missing', async () => {
    vi.mocked(findCompany).mockResolvedValue(null);
    expect(await companyCurrency(ctx, request())).toBe('CAD');
  });

  it('is not available on the platform origin (403)', async () => {
    await expect(companyCurrency(ctx, request(PLATFORM_TENANT))).rejects.toMatchObject({
      status: 403,
    });
    expect(findCompany).not.toHaveBeenCalled();
  });
});

describe('pricingContext', () => {
  it('combines the catalog and the currency', async () => {
    vi.mocked(findCompany).mockResolvedValue({ currency: 'CAD' } as never);
    vi.mocked(loadCatalog).mockResolvedValue(catalog());
    expect(await pricingContext(ctx, request())).toEqual({ catalog: catalog(), currency: 'CAD' });
    expect(loadCatalog).toHaveBeenCalledWith(repo);
  });
});

describe('loadHouse', () => {
  it('returns the house of this tenant', async () => {
    repo.col('houses').findOne.mockResolvedValue(houseDoc());
    expect(await loadHouse(request(), 'house-1')).toEqual(houseDoc());
    expect(repo.col('houses').findOne).toHaveBeenCalledWith({ _id: 'house-1' });
  });

  it('is a 404 when the house does not exist', async () => {
    await expect(loadHouse(request(), 'nope')).rejects.toMatchObject({
      status: 404,
      message: 'House not found',
    });
  });
});

describe('price', () => {
  const pc = { catalog: catalog(), currency: 'CAD' as const };

  it('prices the selection with the shared quote engine', () => {
    vi.mocked(computeQuote).mockReturnValue(quote({ totalCents: 1 }));
    const adjustments = [{ label: 'Discount', amountCents: -100 }];
    const selections = { kitchen: { packageId: 'pkg-signature' } };
    const extras = {
      tax: { code: 'ON', name: 'Ontario', components: [{ label: 'HST', ratePercent: 13 }] },
      referral: null,
    };
    expect(price(houseDoc(), pc, selections, adjustments, extras)).toEqual(
      quote({ totalCents: 1 }),
    );
    expect(computeQuote).toHaveBeenCalledWith(
      { ...houseDoc(), id: 'house-1' },
      pc.catalog,
      selections,
      'CAD',
      adjustments,
      extras,
    );
  });

  it('defaults to no adjustments, no referral and no sales tax', () => {
    vi.mocked(computeQuote).mockReturnValue(quote());
    price(houseDoc(), pc, {});
    expect(vi.mocked(computeQuote).mock.calls[0]![4]).toEqual([]);
    expect(vi.mocked(computeQuote).mock.calls[0]![5]).toEqual({});
  });

  it('turns an invalid configuration into a 422 with the engine message', () => {
    vi.mocked(computeQuote).mockImplementation(() => {
      throw new QuoteError('UNKNOWN_OPTION', 'Package is not in "Kitchen"');
    });
    expect(() => price(houseDoc(), pc, {})).toThrow(
      expect.objectContaining({ status: 422, message: 'Package is not in "Kitchen"' }),
    );
  });

  it('lets unexpected errors through unchanged', () => {
    const boom = new Error('boom');
    vi.mocked(computeQuote).mockImplementation(() => {
      throw boom;
    });
    expect(() => price(houseDoc(), pc, {})).toThrow(boom);
  });
});

describe('pricingExtras', () => {
  const ontario = { code: 'ON', name: 'Ontario', components: [{ label: 'HST', ratePercent: 13 }] };
  const referral = {
    programId: 'prog-1',
    programName: 'Refer a friend',
    referrerName: 'Jo Homeowner',
    creditCents: 200_000,
  };

  it("resolves the province (the company's default when omitted) and the referral", async () => {
    vi.mocked(resolveTaxRate).mockResolvedValue(ontario);
    vi.mocked(applyReferral).mockResolvedValue(referral);
    const input = { programId: 'prog-1', referrerName: 'Jo Homeowner' };
    expect(await pricingExtras(request(), { taxRegion: 'ON', referral: input })).toEqual({
      tax: ontario,
      referral,
    });
    expect(resolveTaxRate).toHaveBeenCalledWith(repo, 'ON');
    expect(applyReferral).toHaveBeenCalledWith(repo, input);

    vi.mocked(resolveTaxRate).mockResolvedValue(null);
    expect(await pricingExtras(request(), {})).toEqual({ tax: null, referral: null });
    expect(resolveTaxRate).toHaveBeenLastCalledWith(repo, undefined);
    expect(applyReferral).toHaveBeenCalledTimes(1);
  });
});

describe('askingPriceAdjustment', () => {
  it('bridges the configured price to the asking price', () => {
    expect(askingPriceAdjustment(quote({ totalCents: 1_000 }), 1_250)).toEqual([
      { label: ASKING_PRICE_LABEL, amountCents: 250 },
    ]);
    expect(askingPriceAdjustment(quote({ totalCents: 1_000 }), 900)).toEqual([
      { label: ASKING_PRICE_LABEL, amountCents: -100 },
    ]);
  });

  it('adds nothing without an asking price or when it already matches', () => {
    expect(askingPriceAdjustment(quote({ totalCents: 1_000 }), undefined)).toEqual([]);
    expect(askingPriceAdjustment(quote({ totalCents: 1_000 }), 1_000)).toEqual([]);
  });
});
