import { ORIGIN_ERRORS } from './messages.js';
import type { Currency } from './money.js';

export interface CompanyContact {
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
}

export type TenantBranding =
  | {
      kind: 'company';
      name: string;
      logoUrl: string;
      currency: Currency;
      tagline?: string;
      heroImageUrl?: string;
      contact?: CompanyContact;
    }
  | { kind: 'platform'; name: string };

/** Normalizes an http(s) origin to lowercase `scheme://host[:port]`; throws on anything else. */
export const normalizeOrigin = (input: string): string => {
  const url = new URL(input.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(ORIGIN_ERRORS.unsupportedScheme(url.protocol));
  }
  return `${url.protocol}//${url.host}`.toLowerCase();
};

export const isValidOrigin = (input: string): boolean => {
  try {
    normalizeOrigin(input);
    return true;
  } catch {
    return false;
  }
};
