export * from './enums.js';
export * from './health.js';
export * from './money.js';
export * from './tenant.js';
export * from './company.js';
export * from './auth.js';
export * from './catalog.js';
export * from './house.js';
export * from './sales-tax.js';
export * from './referral.js';
export * from './quote.js';
export * from './mortgage.js';
export * from './inventory.js';
export * from './proposal.js';
export * from './access.js';
export * from './agreement.js';
export * from './payment.js';

export interface ApiError {
  error: string;
  details?: Record<string, string[]>;
}
export * from './schema-utils.js';
export * from './messages.js';
