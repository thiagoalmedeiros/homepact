import type { Agreement, AgreementTerms } from './agreement.js';
import { AMENDMENT_ERRORS } from './messages.js';
import type { Currency } from './money.js';
import type { ScheduleTerms } from './payment-schedule.js';
import type { QuoteSnapshot } from './quote.js';

/** What an executed amendment leaves on the record: its place in the order, what was signed, and
 * the whole price and terms after it, so the latest one alone says where the agreement stands. */
export interface ExecutedAmendment {
  number: number;
  reference: string;
  contentHash: string;
  executedAt: string;
  quote: QuoteSnapshot;
  terms: AgreementTerms;
}

/** An amendment in effect, as the current state lists it, with the price it left. */
export interface AppliedAmendment extends Pick<
  ExecutedAmendment,
  'number' | 'reference' | 'contentHash' | 'executedAt'
> {
  totalCents: number;
}

/** One step of the price, from what was signed to what it is now. */
export interface PriceChange {
  number: number;
  reference: string;
  executedAt: string;
  fromCents: number;
  toCents: number;
}

/** The part of an agreement its current state is derived from: the price and terms as signed. */
export type AgreementStateSource = Pick<Agreement, 'quote' | 'terms' | 'currency'>;

/** Where an agreement stands now: as signed, then amended by each executed amendment in turn. */
export interface AgreementState {
  quote: QuoteSnapshot;
  terms: AgreementTerms;
  currency: Currency;
  totalCents: number;
  /** The executed amendments in effect, oldest first; empty while it stands as signed. */
  amendments: AppliedAmendment[];
}

/** The one way to ask what an agreement's price and terms are now. The agreement itself is never
 * rewritten: its executed amendments, numbered 1 to n, each carry the state after them, so the
 * latest one wins. Throws if the numbering has a gap or a repeat. */
export const agreementState = (
  agreement: AgreementStateSource,
  executed: readonly ExecutedAmendment[] = [],
): AgreementState => {
  const ordered = [...executed].sort((a, b) => a.number - b.number);
  if (ordered.some((a, i) => a.number !== i + 1)) {
    throw new Error(AMENDMENT_ERRORS.outOfOrder(executed.map((a) => a.number)));
  }
  const latest = ordered.at(-1);
  const quote = latest?.quote ?? agreement.quote;
  return {
    quote,
    terms: latest?.terms ?? agreement.terms,
    currency: agreement.currency,
    totalCents: quote.totalCents,
    amendments: ordered.map(({ number, reference, contentHash, executedAt, quote: q }) => ({
      number,
      reference,
      contentHash,
      executedAt,
      totalCents: q.totalCents,
    })),
  };
};

/** How the price went from `signedTotalCents` through each amendment in effect. */
export const priceChangesOf = (
  signedTotalCents: number,
  amendments: readonly AppliedAmendment[],
): PriceChange[] =>
  amendments.map((a, i) => ({
    number: a.number,
    reference: a.reference,
    executedAt: a.executedAt,
    fromCents: i === 0 ? signedTotalCents : amendments[i - 1]!.totalCents,
    toCents: a.totalCents,
  }));

/** The instalments, closing date and price a payment schedule is worked out against. */
export const scheduleTermsOf = ({ terms, totalCents }: AgreementState): ScheduleTerms => ({
  deposits: terms.deposits,
  ...(terms.closingDate && { closingDate: terms.closingDate }),
  totalCents,
});
