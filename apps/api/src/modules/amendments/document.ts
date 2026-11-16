import type { Amendment } from '@homepact/shared';
import { sha256 } from '../../data/ids.js';
import { canonicalJson } from '../agreements/document.js';
import { identityOf } from '../agreements/purchasers.js';

/** What every party signs: the change order, what it amends, and the price and terms after it. */
const AMENDMENT_CONTENT_KEYS = [
  'reference',
  'number',
  'agreementId',
  'agreementReference',
  'basis',
  'seller',
  'home',
  'purchasers',
  'currency',
  'changes',
  'adjustments',
  'deposits',
  'closingDate',
  'before',
  'after',
  'pricingNote',
  'pricedAt',
] as const satisfies readonly (keyof Amendment)[];

type AmendmentContent = Pick<Amendment, (typeof AMENDMENT_CONTENT_KEYS)[number]>;

/** SHA-256 of the signed content only: not its status, signatures, approval or history. */
export const amendmentContentHash = <T extends AmendmentContent>(amendment: T): string =>
  sha256(
    canonicalJson({
      ...Object.fromEntries(AMENDMENT_CONTENT_KEYS.map((k) => [k, amendment[k]])),
      purchasers: amendment.purchasers.map(identityOf),
    }),
  );
