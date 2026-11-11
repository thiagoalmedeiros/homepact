import { z } from 'zod';

import { CURRENCIES, type Currency } from './format.js';
import { VALIDATION } from './messages.js';

export { CURRENCIES };
export type { Currency };
export const currencySchema = z.enum(CURRENCIES);

export const centsSchema = z.number().int(VALIDATION.wholeCents);

export interface Money {
  amountCents: number;
  currency: Currency;
}

export { formatMoney, formatPercent } from './format.js';
