import { describe, expect, it, vi } from 'vitest';
import { askingPriceAdjustment, price } from '../../../src/modules/houses/pricing.js';
import { quoteInventory, toInventoryHome } from '../../../src/modules/inventory/store.js';
import { catalog, houseDoc, inventoryDoc, quote } from '../../support/fixtures.js';

vi.mock('../../../src/modules/houses/pricing.js', () => ({
  price: vi.fn(),
  askingPriceAdjustment: vi.fn(),
}));

const pc = { catalog: catalog(), currency: 'CAD' as const };
const adjustment = [{ label: 'Pre-existing home price', amountCents: 5 }];

describe('quoteInventory', () => {
  it('prices the configuration, then applies the asking price on top', () => {
    vi.mocked(price)
      .mockReturnValueOnce(quote({ totalCents: 100 }))
      .mockReturnValueOnce(quote({ totalCents: 105 }));
    vi.mocked(askingPriceAdjustment).mockReturnValue(adjustment);
    const home = inventoryDoc({ priceCents: 105 });

    expect(quoteInventory(home, houseDoc(), pc)).toEqual(quote({ totalCents: 105 }));
    expect(price).toHaveBeenNthCalledWith(1, houseDoc(), pc, home.selections);
    expect(askingPriceAdjustment).toHaveBeenCalledWith(quote({ totalCents: 100 }), 105);
    expect(price).toHaveBeenNthCalledWith(2, houseDoc(), pc, home.selections, adjustment);
  });
});

describe('toInventoryHome', () => {
  it('maps the document with its house name and current quote', () => {
    vi.mocked(price).mockReturnValue(quote({ totalCents: 7 }));
    vi.mocked(askingPriceAdjustment).mockReturnValue([]);
    const home = toInventoryHome(inventoryDoc(), houseDoc(), pc);
    expect(home).toMatchObject({
      id: 'home-1',
      houseId: 'house-1',
      houseName: 'The Aspen',
      address: '12 Main St',
      quote: quote({ totalCents: 7 }),
    });
    expect(home).not.toHaveProperty('_id');
    expect(home).not.toHaveProperty('companyId');
  });
});
