import {
  AgreementStatus,
  isPayableAgreement,
  paymentSchedule,
  paymentSummary,
  PaymentKind,
  PaymentStatus,
  type AgreementPayment,
  type AgreementPaymentSummary,
  type BuyerPayment,
  type LedgerEntry,
  type PaymentSchedule,
} from '@homepact/shared';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';
import type { AgreementDoc } from '../agreements/store.js';

export interface PaymentDoc extends TenantDoc, Omit<AgreementPayment, 'id'> {}

export const LIVE_STATUSES = [PaymentStatus.Pending, PaymentStatus.Posted] as const;

export const paymentsOf = (repo: TenantRepo) => repo.of<PaymentDoc>('agreementPayments');

export const toPayment = ({ _id, companyId: _c, ...rest }: PaymentDoc): AgreementPayment => ({
  id: _id,
  ...rest,
});

export const toBuyerPayment = (d: PaymentDoc): BuyerPayment => ({
  id: d._id,
  reference: d.reference,
  kind: d.kind,
  amountCents: d.amountCents,
  currency: d.currency,
  receivedOn: d.receivedOn,
  method: d.method,
});

/** Every entry of an agreement, in the order the money moved. */
export const ledgerOf = (repo: TenantRepo, agreementId: string): Promise<PaymentDoc[]> =>
  paymentsOf(repo).find({ agreementId }, { sort: { receivedOn: 1, recordedAt: 1 } });

export const scheduleOf = (
  agreement: AgreementDoc,
  entries: readonly LedgerEntry[],
  today: string,
): PaymentSchedule =>
  paymentSchedule(
    {
      deposits: agreement.terms.deposits,
      ...(agreement.terms.closingDate && { closingDate: agreement.terms.closingDate }),
      totalCents: agreement.quote.totalCents,
    },
    entries,
    today,
  );

/** Sum of the entries of one kind and status. */
export const totalOf = (
  entries: readonly LedgerEntry[],
  kind: PaymentKind,
  status: PaymentStatus,
): number =>
  entries
    .filter((e) => e.kind === kind && e.status === status)
    .reduce((total, e) => total + e.amountCents, 0);

/** The payment status of each agreement of a list, in one query; cancelled agreements only
 * when they still have entries. */
export const paymentSummaries = async (
  repo: TenantRepo,
  agreements: AgreementDoc[],
  today: string,
): Promise<Map<string, AgreementPaymentSummary>> => {
  const relevant = agreements.filter(
    (a) => isPayableAgreement(a.status) || a.status === AgreementStatus.Cancelled,
  );
  const summaries = new Map<string, AgreementPaymentSummary>();
  if (!relevant.length) return summaries;
  const entries = await paymentsOf(repo).find({
    agreementId: { $in: relevant.map((a) => a._id) },
    status: { $in: [...LIVE_STATUSES] },
  });
  const byAgreement = new Map<string, PaymentDoc[]>();
  for (const e of entries)
    byAgreement.set(e.agreementId, [...(byAgreement.get(e.agreementId) ?? []), e]);
  for (const a of relevant) {
    const own = byAgreement.get(a._id) ?? [];
    if (a.status === AgreementStatus.Cancelled && !own.length) continue;
    summaries.set(a._id, paymentSummary(scheduleOf(a, own, today)));
  }
  return summaries;
};

/** What the company holds for an agreement: posted payments minus posted refunds. */
export const heldFor = async (repo: TenantRepo, agreementId: string): Promise<number> => {
  const posted = await paymentsOf(repo).find({ agreementId, status: PaymentStatus.Posted });
  return (
    totalOf(posted, PaymentKind.Payment, PaymentStatus.Posted) -
    totalOf(posted, PaymentKind.Refund, PaymentStatus.Posted)
  );
};
