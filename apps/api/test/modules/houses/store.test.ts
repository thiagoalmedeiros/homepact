import { describe, expect, it } from 'vitest';
import { HttpError } from '../../../src/http/errors.js';
import {
  assertOverridesInCatalog,
  toDetail,
  toHouse,
  toSummary,
} from '../../../src/modules/houses/store.js';
import { catalog, houseDoc } from '../../support/fixtures.js';

describe('house mappers', () => {
  it('toHouse exposes the id, drops the company and defaults price overrides', () => {
    const { priceOverrides: _p, ...legacy } = houseDoc();
    const house = toHouse(legacy as never);
    expect(house.id).toBe('house-1');
    expect(house).not.toHaveProperty('_id');
    expect(house).not.toHaveProperty('companyId');
    expect(house.priceOverrides).toEqual([]);
  });

  it('toSummary lists the card fields with the first image and the company currency', () => {
    expect(toSummary(houseDoc({ headline: 'Light everywhere' }), 'USD')).toEqual({
      id: 'house-1',
      name: 'The Aspen',
      slug: 'aspen',
      style: 'Modern',
      communities: ['Riverside'],
      specs: { sqft: 2000, beds: 3, baths: 2.5, garage: 2 },
      basePriceCents: 50_000_000,
      currency: 'USD',
      headline: 'Light everywhere',
      imageUrl: 'https://img.test/aspen.jpg',
    });
    const bare = toSummary(houseDoc({ images: [] }), 'CAD');
    expect(bare).not.toHaveProperty('imageUrl');
    expect(bare).not.toHaveProperty('headline');
  });
});

describe('assertOverridesInCatalog', () => {
  it('accepts overrides for catalog packages and items', () => {
    expect(() =>
      assertOverridesInCatalog(
        [
          { refId: 'pkg-signature', priceCents: 1 },
          { refId: 'item-oak', priceCents: 2 },
        ],
        catalog(),
      ),
    ).not.toThrow();
  });

  it("rejects an option that is not in this company's catalog with 422", () => {
    try {
      assertOverridesInCatalog([{ refId: 'foreign-item', priceCents: 1 }], catalog());
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toMatchObject({
        status: 422,
        message: 'Option foreign-item is not in the catalog',
      });
    }
  });
});

describe('toDetail', () => {
  it('offers every catalog option on the plan, cheapest package first, skipping empty areas', () => {
    const detail = toDetail(houseDoc(), catalog(), 'CAD');
    expect(detail.currency).toBe('CAD');
    expect(detail.house).not.toHaveProperty('priceOverrides');
    expect(detail.areas.map((a) => a.slug)).toEqual(['kitchen', 'flooring']);

    const kitchen = detail.areas[0]!;
    expect(kitchen.packages.map((p) => p.name)).toEqual(['Standard', 'Signature']);
    expect(kitchen.packages[1]).toEqual({
      id: 'pkg-signature',
      name: 'Signature',
      priceCents: 900_000,
      itemIds: ['item-island', 'item-hood'],
      itemNames: ['Island', 'Range hood'],
    });
    expect(kitchen.items.find((i) => i.id === 'item-trim')).toMatchObject({
      soldSeparately: false,
    });
    expect(kitchen.items.find((i) => i.id === 'item-island')).toMatchObject({
      soldSeparately: true,
    });
    expect(detail.areas[1]).toMatchObject({ description: 'Main floor' });
  });

  it('applies the plan price overrides and shows the catalog price next to them', () => {
    const detail = toDetail(
      houseDoc({
        priceOverrides: [
          { refId: 'pkg-standard', priceCents: 1_000_000 },
          { refId: 'item-oak', priceCents: 800_000 }, // same as the catalog: no strike-through
        ],
      }),
      catalog(),
      'CAD',
    );
    const kitchen = detail.areas[0]!;
    expect(kitchen.packages.map((p) => [p.name, p.priceCents, p.catalogPriceCents])).toEqual([
      ['Signature', 900_000, undefined],
      ['Standard', 1_000_000, 0],
    ]);
    expect(detail.areas[1]!.items[0]).toEqual({
      id: 'item-oak',
      name: 'Oak',
      priceCents: 800_000,
      soldSeparately: true,
    });
  });

  it('keeps optional descriptions and images on options', () => {
    const c = catalog();
    c.packages[0] = {
      ...c.packages[0]!,
      description: 'Top tier',
      imageUrl: 'https://img.test/p.jpg',
    };
    c.items[3] = { ...c.items[3]!, description: 'Wide plank', imageUrl: 'https://img.test/i.jpg' };
    const detail = toDetail(houseDoc(), c, 'CAD');
    expect(detail.areas[0]!.packages.find((p) => p.id === 'pkg-signature')).toMatchObject({
      description: 'Top tier',
      imageUrl: 'https://img.test/p.jpg',
    });
    expect(detail.areas[1]!.items[0]).toMatchObject({
      description: 'Wide plank',
      imageUrl: 'https://img.test/i.jpg',
    });
  });
});
