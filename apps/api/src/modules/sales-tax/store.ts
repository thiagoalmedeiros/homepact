import { rateOfQuoteTax, type QuoteTax, type SalesTaxRate, type TaxRate } from '@homepact/shared';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';
import { unprocessable } from '../../http/errors.js';
import { ERRORS } from '../../messages.js';

export interface TaxRateDoc extends TenantDoc, Omit<TaxRate, 'id'> {}

export const toTaxRate = ({ _id, companyId: _c, ...rest }: TaxRateDoc): TaxRate => ({
  id: _id,
  ...rest,
});

const rateOf = (doc: TaxRateDoc): SalesTaxRate => ({
  code: doc.code,
  name: doc.name,
  components: doc.components,
});

/** Sales tax for a quote: `null` for none, omitted for the company's default, a code for that
 * province. A removed province still prices with `previous` when it is the same one. */
export const resolveTaxRate = async (
  repo: TenantRepo,
  code: string | null | undefined,
  previous?: QuoteTax,
): Promise<SalesTaxRate | null> => {
  if (code === null) return null;
  const rates = repo.of<TaxRateDoc>('taxRates');
  if (code === undefined) {
    const fallback = await rates.findOne({ isDefault: true });
    return fallback ? rateOf(fallback) : null;
  }
  const doc = await rates.findOne({ code });
  if (doc) return rateOf(doc);
  if (previous?.regionCode === code) return rateOfQuoteTax(previous);
  throw unprocessable(ERRORS.taxes.unknownRegion(code));
};

/** Re-pricing keeps the quote's province at the company's current rate; an untaxed quote stays
 * untaxed. */
export const carriedTaxRate = (
  repo: TenantRepo,
  previous: QuoteTax | undefined,
): Promise<SalesTaxRate | null> =>
  previous ? resolveTaxRate(repo, previous.regionCode, previous) : Promise.resolve(null);
