import { describe, expect, it } from 'vitest';
import {
  AgreementStatus,
  InstalmentStatus,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  isPayableAgreement,
  isRefundableAgreement,
  netPaid,
  paymentCreateSchema,
  paymentReasonSchema,
  paymentSchedule,
  paymentSummary,
  paymentUpdateSchema,
  type LedgerEntry,
  type ScheduleTerms,
} from '../src/index.js';

const TODAY = '2026-11-15';
const TERMS: ScheduleTerms = {
  deposits: [
    { label: 'on signing', amountCents: 1_000_000 },
    { label: 'in 30 days', amountCents: 1_500_000, dueDate: '2026-12-01' },
  ],
  closingDate: '2027-03-15',
  totalCents: 50_000_000,
};
const paid = (amountCents: number, status = PaymentStatus.Posted): LedgerEntry => ({
  kind: PaymentKind.Payment,
  status,
  amountCents,
});
const refund = (amountCents: number, status = PaymentStatus.Posted): LedgerEntry => ({
  kind: PaymentKind.Refund,
  status,
  amountCents,
});
const statuses = (entries: LedgerEntry[], terms = TERMS, today = TODAY) =>
  paymentSchedule(terms, entries, today).lines.map((l) => [l.paidCents, l.status]);

describe('paymentSchedule', () => {
  it('lists each instalment, then the balance due on closing', () => {
    const { lines, totals } = paymentSchedule(TERMS, [], TODAY);
    expect(lines).toEqual([
      {
        kind: 'deposit',
        index: 0,
        label: 'on signing',
        amountCents: 1_000_000,
        paidCents: 0,
        remainingCents: 1_000_000,
        status: InstalmentStatus.Due,
      },
      {
        kind: 'deposit',
        index: 1,
        label: 'in 30 days',
        dueDate: '2026-12-01',
        amountCents: 1_500_000,
        paidCents: 0,
        remainingCents: 1_500_000,
        status: InstalmentStatus.Upcoming,
      },
      {
        kind: 'closing',
        dueDate: '2027-03-15',
        amountCents: 47_500_000,
        paidCents: 0,
        remainingCents: 47_500_000,
        status: InstalmentStatus.Upcoming,
      },
    ]);
    expect(totals).toEqual({
      totalCents: 50_000_000,
      depositCents: 2_500_000,
      paidCents: 0,
      refundedCents: 0,
      netPaidCents: 0,
      outstandingCents: 50_000_000,
      overdueCents: 0,
      creditCents: 0,
      pendingCents: 0,
      pendingCount: 0,
    });
  });

  it('applies posted money in schedule order; a partial payment leaves the rest due', () => {
    expect(statuses([paid(400_000)])).toEqual([
      [400_000, InstalmentStatus.Partial],
      [0, InstalmentStatus.Upcoming],
      [0, InstalmentStatus.Upcoming],
    ]);
    expect(statuses([paid(400_000), paid(600_000)])).toEqual([
      [1_000_000, InstalmentStatus.Paid],
      [0, InstalmentStatus.Upcoming],
      [0, InstalmentStatus.Upcoming],
    ]);
  });

  it('carries an overpayment of one instalment into the next', () => {
    const { lines, totals } = paymentSchedule(TERMS, [paid(1_200_000)], TODAY);
    expect(lines.map((l) => [l.paidCents, l.remainingCents, l.status])).toEqual([
      [1_000_000, 0, InstalmentStatus.Paid],
      [200_000, 1_300_000, InstalmentStatus.Partial],
      [0, 47_500_000, InstalmentStatus.Upcoming],
    ]);
    expect(totals.outstandingCents).toBe(48_800_000);
  });

  it('only posted entries count; pending ones are reported apart', () => {
    const { lines, totals } = paymentSchedule(
      TERMS,
      [
        paid(1_000_000, PaymentStatus.Pending),
        paid(500_000, PaymentStatus.Rejected),
        paid(500_000, PaymentStatus.Withdrawn),
        paid(500_000, PaymentStatus.Voided),
        refund(500_000, PaymentStatus.Voided),
      ],
      TODAY,
    );
    expect(lines[0]!.paidCents).toBe(0);
    expect(totals).toMatchObject({
      paidCents: 0,
      refundedCents: 0,
      netPaidCents: 0,
      pendingCents: 1_000_000,
      pendingCount: 1,
    });
  });

  it('refunds take money back from the end of the schedule', () => {
    const entries = [paid(1_000_000), paid(1_500_000), refund(500_000)];
    const { lines, totals } = paymentSchedule(TERMS, entries, TODAY);
    expect(lines.map((l) => l.paidCents)).toEqual([1_000_000, 1_000_000, 0]);
    expect(totals).toMatchObject({
      paidCents: 2_500_000,
      refundedCents: 500_000,
      netPaidCents: 2_000_000,
      outstandingCents: 48_000_000,
    });
    expect(netPaid(entries)).toBe(2_000_000);
  });

  it('flags what is past due, partially paid or not', () => {
    const late = '2026-12-02';
    expect(statuses([paid(1_200_000)], TERMS, late)).toEqual([
      [1_000_000, InstalmentStatus.Paid],
      [200_000, InstalmentStatus.Overdue],
      [0, InstalmentStatus.Upcoming],
    ]);
    expect(paymentSchedule(TERMS, [paid(1_200_000)], late).totals.overdueCents).toBe(1_300_000);
    expect(statuses([], TERMS, '2026-12-01')[1]).toEqual([0, InstalmentStatus.Due]);
  });

  it('a closing without a date is upcoming, never due', () => {
    const { closingDate: _, ...undated } = TERMS;
    expect(statuses([], undated, '2030-01-01')[2]).toEqual([0, InstalmentStatus.Upcoming]);
  });

  it('paid in full: every line is paid; no closing line when the deposit is the whole price', () => {
    const { lines, totals } = paymentSchedule(TERMS, [paid(50_000_000)], TODAY);
    expect(lines.every((l) => l.status === InstalmentStatus.Paid)).toBe(true);
    expect(totals.outstandingCents).toBe(0);

    const whole = { deposits: [{ label: 'all', amountCents: 100 }], totalCents: 100 };
    expect(paymentSchedule(whole, [], TODAY).lines).toHaveLength(1);
  });

  it('money beyond the price is reported as a credit', () => {
    const { totals } = paymentSchedule(TERMS, [paid(50_000_100)], TODAY);
    expect(totals).toMatchObject({ outstandingCents: 0, creditCents: 100 });
  });

  it('summarises the schedule for the agreements list', () => {
    const schedule = paymentSchedule(
      TERMS,
      [paid(1_000_000), paid(10, PaymentStatus.Pending)],
      '2026-12-05',
    );
    expect(paymentSummary(schedule)).toEqual({
      netPaidCents: 1_000_000,
      outstandingCents: 49_000_000,
      overdueCents: 1_500_000,
      pendingCount: 1,
    });
  });
});

describe('when an agreement takes payments', () => {
  it('payments once every purchaser signed; refunds also after a cancellation', () => {
    expect(Object.values(AgreementStatus).filter(isPayableAgreement)).toEqual([
      AgreementStatus.Signed,
      AgreementStatus.Executed,
    ]);
    expect(Object.values(AgreementStatus).filter(isRefundableAgreement)).toEqual([
      AgreementStatus.Signed,
      AgreementStatus.Executed,
      AgreementStatus.Cancelled,
    ]);
  });
});

describe('payment input', () => {
  const base = { amountCents: 1_000_000, receivedOn: '2026-11-14', method: PaymentMethod.Cheque };

  it('defaults to a payment, trims text and never records a duplicate unless asked', () => {
    expect(paymentCreateSchema.parse({ ...base, externalRef: ' #123 ' })).toEqual({
      ...base,
      kind: PaymentKind.Payment,
      externalRef: '#123',
      allowDuplicate: false,
    });
  });

  it('rejects zero, fractions of a cent, impossible dates and unknown methods', () => {
    for (const bad of [
      { amountCents: 0 },
      { amountCents: 10.5 },
      { receivedOn: '2026-02-30' },
      { receivedOn: '14/11/2026' },
      { method: 'barter' },
      { kind: 'gift' },
    ]) {
      expect(paymentCreateSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it('an edit cannot turn a payment into a refund or re-link it', () => {
    const parsed = paymentUpdateSchema.parse({ ...base, kind: 'refund', replacesId: 'p-1' });
    expect(parsed).not.toHaveProperty('kind');
    expect(parsed).not.toHaveProperty('replacesId');
  });

  it('a rejection or void needs a real reason', () => {
    expect(paymentReasonSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(paymentReasonSchema.parse({ reason: ' NSF cheque ' })).toEqual({ reason: 'NSF cheque' });
  });
});
