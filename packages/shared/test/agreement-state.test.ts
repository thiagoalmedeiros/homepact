import { describe, expect, it } from 'vitest';
import {
  agreementState,
  paymentSchedule,
  PaymentKind,
  PaymentStatus,
  priceChangesOf,
  scheduleTermsOf,
  type AgreementStateSource,
  type AgreementTerms,
  type ExecutedAmendment,
  type QuoteSnapshot,
} from '../src/index.js';

const quote = (totalCents: number): QuoteSnapshot => ({
  houseId: 'house-1',
  houseName: 'The Alder',
  currency: 'CAD',
  baseCents: totalCents,
  lines: [],
  adjustments: [],
  subtotalCents: totalCents,
  totalCents,
});

const terms = (deposits: number[], closingDate?: string): AgreementTerms => ({
  deposits: deposits.map((amountCents, i) => ({ label: `Deposit ${i + 1}`, amountCents })),
  depositCents: deposits.reduce((t, d) => t + d, 0),
  conditions: [],
  ...(closingDate && { closingDate }),
});

const SIGNED: AgreementStateSource = {
  quote: quote(50_000_000),
  terms: terms([1_000_000, 1_500_000], '2027-03-15'),
  currency: 'CAD',
};

const amendment = (number: number, totalCents: number, deposits: number[]): ExecutedAmendment => ({
  number,
  reference: `A-1-${number}`,
  contentHash: String(number).repeat(64).slice(0, 64),
  executedAt: `2026-12-0${number}T10:00:00.000Z`,
  quote: quote(totalCents),
  terms: terms(deposits, '2027-04-01'),
});

describe('agreementState', () => {
  it('is the agreement as signed until an amendment is executed', () => {
    expect(agreementState(SIGNED)).toEqual({
      quote: SIGNED.quote,
      terms: SIGNED.terms,
      currency: 'CAD',
      totalCents: 50_000_000,
      amendments: [],
    });
  });

  it('takes the price and terms of the latest executed amendment, whatever order they come in', () => {
    const first = amendment(1, 50_400_000, [1_000_000, 1_500_000]);
    const second = amendment(2, 50_150_000, [1_000_000, 1_500_000, 250_000]);
    const state = agreementState(SIGNED, [second, first]);
    expect(state.quote).toBe(second.quote);
    expect(state.terms).toBe(second.terms);
    expect(state.totalCents).toBe(50_150_000);
    expect(state.amendments).toEqual([
      {
        number: 1,
        reference: 'A-1-1',
        contentHash: first.contentHash,
        executedAt: first.executedAt,
        totalCents: 50_400_000,
      },
      {
        number: 2,
        reference: 'A-1-2',
        contentHash: second.contentHash,
        executedAt: second.executedAt,
        totalCents: 50_150_000,
      },
    ]);
  });

  it('never changes the agreement or the amendments it is given', () => {
    const amendments = [amendment(2, 3, [1]), amendment(1, 2, [1])];
    const before = structuredClone({ SIGNED, amendments });
    agreementState(SIGNED, amendments);
    expect({ SIGNED, amendments }).toEqual(before);
  });

  it.each([
    ['a gap', [1, 3]],
    ['a repeat', [1, 1]],
    ['no first amendment', [2]],
  ])('refuses amendments numbered with %s', (_case, numbers) => {
    expect(() =>
      agreementState(
        SIGNED,
        numbers.map((n) => amendment(n, 1, [1])),
      ),
    ).toThrow(/numbered 1 to n/);
  });
});

describe('scheduleTermsOf', () => {
  it('gives the payment schedule the current instalments, closing date and price', () => {
    expect(scheduleTermsOf(agreementState(SIGNED))).toEqual({
      deposits: SIGNED.terms.deposits,
      closingDate: '2027-03-15',
      totalCents: 50_000_000,
    });
  });

  it('leaves out a closing date that is not set', () => {
    const open = { ...SIGNED, terms: terms([1_000_000]) };
    expect(scheduleTermsOf(agreementState(open))).not.toHaveProperty('closingDate');
  });
});

describe('priceChangesOf', () => {
  it('tells how the price went from what was signed to what it is now', () => {
    const state = agreementState(SIGNED, [
      amendment(1, 50_400_000, [1_000_000, 1_500_000]),
      amendment(2, 50_150_000, [1_000_000, 1_500_000]),
    ]);
    expect(priceChangesOf(SIGNED.quote.totalCents, state.amendments)).toEqual([
      {
        number: 1,
        reference: 'A-1-1',
        executedAt: '2026-12-01T10:00:00.000Z',
        fromCents: 50_000_000,
        toCents: 50_400_000,
      },
      {
        number: 2,
        reference: 'A-1-2',
        executedAt: '2026-12-02T10:00:00.000Z',
        fromCents: 50_400_000,
        toCents: 50_150_000,
      },
    ]);
    expect(priceChangesOf(50_000_000, [])).toEqual([]);
  });
});

describe('money after an amendment', () => {
  const received = (amountCents: number) => ({
    kind: PaymentKind.Payment,
    status: PaymentStatus.Posted,
    amountCents,
  });

  it('a price cut below what was received leaves every line paid and a credit', () => {
    const state = agreementState(SIGNED, [amendment(1, 45_000_000, [1_000_000, 1_500_000])]);
    const { lines, totals } = paymentSchedule(
      scheduleTermsOf(state),
      [received(47_000_000)],
      '2026-12-15',
    );
    expect(lines.every((l) => l.remainingCents === 0)).toBe(true);
    expect(totals).toMatchObject({
      totalCents: 45_000_000,
      netPaidCents: 47_000_000,
      outstandingCents: 0,
      overdueCents: 0,
      creditCents: 2_000_000,
    });
  });

  it('an added instalment already due is overdue; a later closing date is not', () => {
    const late = {
      ...amendment(1, 51_000_000, []),
      terms: terms([1_000_000, 500_000], '2027-06-30'),
    };
    late.terms.deposits[1] = {
      label: 'Upgrade payment',
      amountCents: 500_000,
      dueDate: '2026-12-01',
    };
    const { lines, totals } = paymentSchedule(
      scheduleTermsOf(agreementState(SIGNED, [late])),
      [received(1_000_000)],
      '2026-12-15',
    );
    expect(lines.map((l) => [l.kind, l.dueDate, l.status])).toEqual([
      ['deposit', undefined, 'paid'],
      ['deposit', '2026-12-01', 'overdue'],
      ['closing', '2027-06-30', 'upcoming'],
    ]);
    expect(totals.overdueCents).toBe(500_000);
    expect(totals.outstandingCents).toBe(50_000_000);
  });
});
