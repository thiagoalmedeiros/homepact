import type { InventoryHome } from '@homepact/shared';
import type { TenantDoc } from '../../data/tenant-repo.js';
import type { HouseDoc } from '../houses/store.js';
import { askingPriceAdjustment, price, type PricingContext } from '../houses/pricing.js';

export interface InventoryHomeDoc
  extends TenantDoc, Omit<InventoryHome, 'id' | 'quote' | 'houseName'> {}

/** Price of a pre-existing home as configured, with its asking price applied. */
export const quoteInventory = (
  home: Pick<InventoryHomeDoc, 'selections' | 'priceCents'>,
  house: HouseDoc,
  pc: PricingContext,
) => {
  const configured = price(house, pc, home.selections);
  return price(house, pc, home.selections, askingPriceAdjustment(configured, home.priceCents));
};

export const toInventoryHome = (
  doc: InventoryHomeDoc,
  house: HouseDoc,
  pc: PricingContext,
): InventoryHome => {
  const { _id, companyId: _c, ...rest } = doc;
  return { id: _id, ...rest, houseName: house.name, quote: quoteInventory(doc, house, pc) };
};
