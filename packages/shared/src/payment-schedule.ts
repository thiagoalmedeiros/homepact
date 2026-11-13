import type { DepositInstalment } from './agreement.js';
import { InstalmentStatus, PaymentKind, PaymentStatus } from './enums.js';

export interface ScheduleLine {
  kind: 'deposit' | 'closing';
  index?: number;
  label?: string;
  dueDate?: string;
  amountCents: number;
  paidCents: number;
  remainingCents: number;
  status: InstalmentStatus;
}

export interface PaymentTotals {
  totalCents: number;
  depositCents: number;
  paidCents: number;
  refundedCents: number;
  netPaidCents: number;
  outstandingCents: number;
  overdueCents: number;
  creditCents: number;
  pendingCents: number;
  pendingCount: number;
}

export interface PaymentSchedule {
  lines: ScheduleLine[];
  totals: PaymentTotals;
}

export interface AgreementPaymentSummary {
  netPaidCents: number;
  outstandingCents: number;
  overdueCents: number;
  pendingCount: number;
}

export interface ScheduleTerms {
  deposits: readonly DepositInstalment[];
  closingDate?: string;
  totalCents: number;
}

export interface LedgerEntry {
  kind: PaymentKind;
  status: PaymentStatus;
  amountCents: number;
}

const sum = (entries: readonly LedgerEntry[], kind: PaymentKind, status: PaymentStatus) =>
  entries
    .filter((e) => e.kind === kind && e.status === status)
    .reduce((total, e) => total + e.amountCents, 0);

/** Posted payments minus posted refunds: the money the company holds for this agreement. */
export const netPaid = (entries: readonly LedgerEntry[]): number =>
  sum(entries, PaymentKind.Payment, PaymentStatus.Posted) -
  sum(entries, PaymentKind.Refund, PaymentStatus.Posted);

/** A dated line is overdue once its day has passed; an undated deposit is due on signing, an
 * undated closing balance is not due yet. */
const lineStatus = (
  kind: ScheduleLine['kind'],
  paid: number,
  remaining: number,
  today: string,
  dueDate?: string,
): InstalmentStatus => {
  if (remaining === 0) return InstalmentStatus.Paid;
  if (dueDate && dueDate < today) return InstalmentStatus.Overdue;
  if (paid > 0) return InstalmentStatus.Partial;
  if (dueDate ? dueDate === today : kind === 'deposit') return InstalmentStatus.Due;
  return InstalmentStatus.Upcoming;
};

/** Where an agreement stands against its schedule: posted money fills the instalments in order,
 * then the closing balance; refunds take it back from the end. `today` is "YYYY-MM-DD". */
export const paymentSchedule = (
  terms: ScheduleTerms,
  entries: readonly LedgerEntry[],
  today: string,
): PaymentSchedule => {
  const depositCents = terms.deposits.reduce((total, d) => total + d.amountCents, 0);
  const closingCents = terms.totalCents - depositCents;
  const due: Omit<ScheduleLine, 'paidCents' | 'remainingCents' | 'status'>[] = [
    ...terms.deposits.map((d, index) => ({
      kind: 'deposit' as const,
      index,
      label: d.label,
      ...(d.dueDate && { dueDate: d.dueDate }),
      amountCents: d.amountCents,
    })),
    ...(closingCents > 0
      ? [
          {
            kind: 'closing' as const,
            ...(terms.closingDate && { dueDate: terms.closingDate }),
            amountCents: closingCents,
          },
        ]
      : []),
  ];

  const paidCents = sum(entries, PaymentKind.Payment, PaymentStatus.Posted);
  const refundedCents = sum(entries, PaymentKind.Refund, PaymentStatus.Posted);
  const held = paidCents - refundedCents;
  let left = Math.max(0, held);
  const lines = due.map((line): ScheduleLine => {
    const paid = Math.min(line.amountCents, left);
    left -= paid;
    const remaining = line.amountCents - paid;
    return {
      ...line,
      paidCents: paid,
      remainingCents: remaining,
      status: lineStatus(line.kind, paid, remaining, today, line.dueDate),
    };
  });

  const pending = entries.filter(
    (e) => e.kind === PaymentKind.Payment && e.status === PaymentStatus.Pending,
  );
  return {
    lines,
    totals: {
      totalCents: terms.totalCents,
      depositCents,
      paidCents,
      refundedCents,
      netPaidCents: held,
      outstandingCents: Math.max(0, terms.totalCents - held),
      overdueCents: lines
        .filter((l) => l.status === InstalmentStatus.Overdue)
        .reduce((total, l) => total + l.remainingCents, 0),
      creditCents: left,
      pendingCents: pending.reduce((total, e) => total + e.amountCents, 0),
      pendingCount: pending.length,
    },
  };
};

export const paymentSummary = ({ totals }: PaymentSchedule): AgreementPaymentSummary => ({
  netPaidCents: totals.netPaidCents,
  outstandingCents: totals.outstandingCents,
  overdueCents: totals.overdueCents,
  pendingCount: totals.pendingCount,
});
