import {
  computeQuote,
  QuoteError,
  type Adjustment,
  type Catalog,
  type Currency,
  type QuoteExtras,
  type QuoteSnapshot,
  type ReferralInput,
  type Selections,
} from '@homepact/shared';
import type { Request } from 'express';
import type { ModuleContext } from '../../context.js';
import { findCompany } from '../../data/platform-repo.js';
import { forbidden, notFound, unprocessable } from '../../http/errors.js';
import { loadCatalog } from '../catalog/store.js';
import { applyReferral } from '../referrals/store.js';
import { resolveTaxRate } from '../sales-tax/store.js';
import type { HouseDoc } from './store.js';
import { ERRORS } from '../../messages.js';

export const companyCurrency = async (ctx: ModuleContext, req: Request): Promise<Currency> => {
  if (req.tenant.kind !== 'company') throw forbidden(ERRORS.tenant.notOnThisOrigin);
  return (await findCompany(ctx.db, req.tenant.companyId))?.currency ?? 'CAD';
};

export interface PricingContext {
  catalog: Catalog;
  currency: Currency;
}

export const pricingContext = async (ctx: ModuleContext, req: Request): Promise<PricingContext> => {
  const [catalog, currency] = await Promise.all([loadCatalog(req.repo), companyCurrency(ctx, req)]);
  return { catalog, currency };
};

export const loadHouse = async (req: Request, houseId: string): Promise<HouseDoc> => {
  const house = await req.repo.of<HouseDoc>('houses').findOne({ _id: houseId });
  if (!house) throw notFound(ERRORS.houses.notFound);
  return house;
};

/** The province (the default when omitted) and the referral a new quote adds; unknown ones are a
 * 422. */
export const pricingExtras = async (
  req: Request,
  input: { taxRegion?: string | null | undefined; referral?: ReferralInput | undefined },
): Promise<QuoteExtras> => {
  const [tax, referral] = await Promise.all([
    resolveTaxRate(req.repo, input.taxRegion),
    input.referral ? applyReferral(req.repo, input.referral) : null,
  ]);
  return { tax, referral };
};

/** Server-side pricing; anything the house does not offer is a 422. */
export const price = (
  house: HouseDoc,
  pc: PricingContext,
  selections: Selections,
  adjustments: Adjustment[] = [],
  extras: QuoteExtras = {},
): QuoteSnapshot => {
  try {
    return computeQuote(
      { ...house, id: house._id },
      pc.catalog,
      selections,
      pc.currency,
      adjustments,
      extras,
    );
  } catch (err) {
    if (err instanceof QuoteError) throw unprocessable(err.message);
    throw err;
  }
};

export const ASKING_PRICE_LABEL = 'Pre-existing home price';

/** Bridges a home's configured price to its asking price, both before tax. */
export const askingPriceAdjustment = (
  quote: QuoteSnapshot,
  priceCents: number | undefined,
): Adjustment[] =>
  priceCents === undefined || priceCents === quote.totalCents
    ? []
    : [{ label: ASKING_PRICE_LABEL, amountCents: priceCents - quote.totalCents }];
