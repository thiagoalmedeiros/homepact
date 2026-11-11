export type Currency = 'CAD' | 'USD';
export const CURRENCIES = ['CAD', 'USD'] as const satisfies readonly Currency[];

export const formatMoney = (amountCents: number, currency: Currency, locale = 'en-CA'): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);

/** A tax rate as people read it: 13 → "13%", 9.975 → "9.975%". */
export const formatPercent = (ratePercent: number, locale = 'en-CA'): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 3 }).format(
    ratePercent / 100,
  );
