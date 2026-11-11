import { describe, expect, it } from 'vitest';
import {
  computeQuote,
  priceBeforeTax,
  QuoteError,
  salesTaxOf,
  type Catalog,
  type House,
  type QuoteReferral,
  type QuoteSnapshot,
} from '../src/index.js';

const catalog: Catalog = {
  areas: [
    { slug: 'kitchen', label: 'Kitchen', order: 1 },
    { slug: 'exterior', label: 'Exterior', order: 0 },
  ],
  items: [
    { id: 'quartz', areaSlug: 'kitchen', name: 'Quartz counters', priceCents: 500_000 },
    { id: 'island', areaSlug: 'kitchen', name: 'Island', priceCents: 300_000 },
    { id: 'stone', areaSlug: 'exterior', name: 'Stone accents', priceCents: 900_000 },
    {
      id: 'brick',
      areaSlug: 'exterior',
      name: 'Brick facade',
      priceCents: 400_000,
      soldSeparately: false,
    },
  ],
  packages: [
    {
      id: 'chef',
      areaSlug: 'kitchen',
      name: 'Chef package',
      itemIds: ['quartz', 'island'],
      priceCents: 700_000,
    },
  ],
};

const house: Pick<House, 'id' | 'name' | 'basePriceCents' | 'priceOverrides'> = {
  id: 'h1',
  name: 'Alder',
  basePriceCents: 60_000_000,
  priceOverrides: [
    { refId: 'chef', priceCents: 650_000 },
    { refId: 'island', priceCents: 250_000 },
  ],
};

describe('computeQuote', () => {
  it('quote = base + package price or item prices with overrides', () => {
    const withPackage = computeQuote(house, catalog, { kitchen: { packageId: 'chef' } }, 'CAD');
    expect(withPackage.totalCents).toBe(60_000_000 + 650_000);
    expect(withPackage.lines).toHaveLength(1);

    const withItems = computeQuote(
      house,
      catalog,
      { kitchen: { itemIds: ['quartz', 'island'] }, exterior: { itemIds: ['stone'] } },
      'CAD',
      [{ label: 'Promo', amountCents: -100_000 }],
    );
    expect(withItems.totalCents).toBe(60_000_000 + 500_000 + 250_000 + 900_000 - 100_000);
    expect(withItems.lines.map((l) => l.refId)).toEqual(['stone', 'quartz', 'island']);
  });

  it('package and items in the same area are mutually exclusive', () => {
    expect(() =>
      computeQuote(
        house,
        catalog,
        { kitchen: { packageId: 'chef', itemIds: ['quartz'] } as never },
        'CAD',
      ),
    ).toThrowError(QuoteError);
  });

  it('every catalog option is available on every plan; unknown options are rejected', () => {
    const plain = { id: 'h2', name: 'Willow', basePriceCents: 50_000_000 };
    expect(
      computeQuote(plain, catalog, { exterior: { itemIds: ['stone'] } }, 'CAD').totalCents,
    ).toBe(50_900_000);
    expect(() =>
      computeQuote(house, catalog, { exterior: { itemIds: ['quartz'] } }, 'CAD'),
    ).toThrowError(/not in "Exterior"/);
    expect(() => computeQuote(house, catalog, { basement: { itemIds: [] } }, 'CAD')).toThrowError(
      /Unknown area/,
    );
  });

  it('items only sold inside a package cannot be picked on their own', () => {
    expect(() =>
      computeQuote(house, catalog, { exterior: { itemIds: ['brick'] } }, 'CAD'),
    ).toThrowError(/only sold as part of a package/);
  });
});

describe('computeQuote: referral credit and sales tax', () => {
  const referral: QuoteReferral = {
    programId: 'friends',
    programName: 'Refer a friend',
    referrerName: 'Jo Homeowner',
    creditCents: 200_000,
  };
  const ontario = { code: 'ON', name: 'Ontario', components: [{ label: 'HST', ratePercent: 13 }] };
  const quebec = {
    code: 'QC',
    name: 'Quebec',
    components: [
      { label: 'GST', ratePercent: 5 },
      { label: 'QST', ratePercent: 9.975 },
    ],
  };
  const chef = { kitchen: { packageId: 'chef' } };

  it('the credit comes off before tax, and the tax is charged on what is left', () => {
    const q = computeQuote(house, catalog, chef, 'CAD', [], { referral, tax: ontario });
    const beforeTax = 60_000_000 + 650_000 - 200_000;
    expect(q.subtotalCents).toBe(beforeTax);
    expect(q.referral).toEqual(referral);
    expect(q.tax).toEqual({
      regionCode: 'ON',
      regionName: 'Ontario',
      lines: [{ label: 'HST', ratePercent: 13, amountCents: 7_858_500 }],
      totalCents: 7_858_500,
    });
    expect(q.totalCents).toBe(beforeTax + 7_858_500);
    expect(priceBeforeTax(q)).toBe(beforeTax);
    expect(salesTaxOf(q)).toBe(7_858_500);
  });

  it('each tax of a province is its own line, rounded to the cent on its own', () => {
    const q = computeQuote(
      { id: 'h', name: 'Odd', basePriceCents: 12_345_67 },
      catalog,
      {},
      'CAD',
      [],
      {
        tax: quebec,
      },
    );
    expect(q.tax!.lines.map((l) => l.amountCents)).toEqual([61_728, 123_148]);
    expect(q.tax!.totalCents).toBe(184_876);
    expect(q.totalCents).toBe(1_234_567 + 184_876);
  });

  it('without a province there is no tax: the total is the price before tax', () => {
    const q = computeQuote(house, catalog, chef, 'CAD');
    expect(q).not.toHaveProperty('tax');
    expect(q).not.toHaveProperty('referral');
    expect(q.subtotalCents).toBe(q.totalCents);
    expect(salesTaxOf(q)).toBe(0);
  });

  it('quotes priced before taxes existed read as untaxed', () => {
    const legacy: Pick<QuoteSnapshot, 'subtotalCents' | 'tax' | 'totalCents'> = {
      totalCents: 5_000_000,
    };
    expect(priceBeforeTax(legacy)).toBe(5_000_000);
    expect(salesTaxOf(legacy)).toBe(0);
  });

  it('a credit larger than the price is refused', () => {
    expect(() =>
      computeQuote({ id: 'h', name: 'Tiny', basePriceCents: 100_000 }, catalog, {}, 'CAD', [], {
        referral,
      }),
    ).toThrowError(QuoteError);
  });
});
