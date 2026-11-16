import {
  agreementState,
  AmendmentStatus,
  DEFAULT_AMENDMENT_POLICY,
  type AgreementState,
  type Amendment,
  type AmendmentPolicy,
  type AmendmentSummary,
  type ExecutedAmendment,
} from '@homepact/shared';
import { isDuplicateKey } from '../../http/errors.js';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';
import type { AgreementDoc } from '../agreements/store.js';

export interface AmendmentDoc
  extends TenantDoc, Omit<Amendment, 'id' | 'executedPdf' | 'viewerPurchaserId'> {
  executedPdf?: { fileId: string; sha256: string; size: number };
}

/** One per agreement that was ever amended: which amendment, if any, holds it. */
interface AmendmentHeadDoc extends TenantDoc {
  openAmendmentId?: string;
  updatedAt: string;
}

interface AmendmentPolicyDoc extends TenantDoc, AmendmentPolicy {
  updatedByName: string;
  updatedAt: string;
}

export const amendmentsOf = (repo: TenantRepo) => repo.of<AmendmentDoc>('agreementAmendments');
const heads = (repo: TenantRepo) => repo.of<AmendmentHeadDoc>('amendmentHeads');
const policies = (repo: TenantRepo) => repo.of<AmendmentPolicyDoc>('amendmentPolicies');

export const toAmendment = (d: AmendmentDoc, viewerPurchaserId?: string): Amendment => {
  const { _id, companyId: _c, executedPdf, ...rest } = d;
  return {
    id: _id,
    ...rest,
    ...(executedPdf && { executedPdf: { sha256: executedPdf.sha256, size: executedPdf.size } }),
    ...(viewerPurchaserId && { viewerPurchaserId }),
  };
};

export const toAmendmentSummary = (d: AmendmentDoc): AmendmentSummary => ({
  id: d._id,
  reference: d.reference,
  number: d.number,
  agreementId: d.agreementId,
  agreementReference: d.agreementReference,
  status: d.status,
  changeCount: d.changes.length,
  beforeTotalCents: d.before.quote.totalCents,
  ...(d.after && { afterTotalCents: d.after.quote.totalCents }),
  currency: d.currency,
  approvalReasons: d.approval?.reasons ?? [],
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/** What an executed amendment contributes to its agreement's current state. */
const toExecuted = (d: AmendmentDoc): ExecutedAmendment => ({
  number: d.number,
  reference: d.reference,
  contentHash: d.contentHash!,
  executedAt: d.executedAt!,
  quote: d.after!.quote,
  terms: d.after!.terms,
});

/** Every agreement's current state, from its executed amendments, in one query. */
export const statesOf = async (
  repo: TenantRepo,
  agreements: readonly AgreementDoc[],
): Promise<Map<string, AgreementState>> => {
  const states = new Map<string, AgreementState>();
  if (!agreements.length) return states;
  const executed = await amendmentsOf(repo).find(
    { agreementId: { $in: agreements.map((a) => a._id) }, status: AmendmentStatus.Executed },
    { sort: { number: 1 } },
  );
  for (const a of agreements) {
    const own = executed.filter((e) => e.agreementId === a._id).map(toExecuted);
    states.set(a._id, agreementState(a, own));
  }
  return states;
};

/** The agreement's price and terms now: as signed, then amended by each executed amendment. */
export const stateOf = async (repo: TenantRepo, agreement: AgreementDoc): Promise<AgreementState> =>
  (await statesOf(repo, [agreement])).get(agreement._id)!;

/** The executed amendment the agreement stands on, if any. */
export const latestExecutedOf = async (
  repo: TenantRepo,
  agreementId: string,
): Promise<AmendmentDoc | undefined> =>
  (
    await amendmentsOf(repo).find(
      { agreementId, status: AmendmentStatus.Executed },
      { sort: { number: -1 }, limit: 1 },
    )
  )[0];

/** Takes the agreement for one amendment; false if another one holds it. Only the amendment that
 * holds an agreement can be executed, so each one amends the state the previous one left. */
export const claimAgreement = async (
  repo: TenantRepo,
  agreementId: string,
  amendmentId: string,
  at: Date,
): Promise<boolean> => {
  const ts = at.toISOString();
  if (!(await heads(repo).findOne({ _id: agreementId }))) {
    try {
      await heads(repo).insertOne({ _id: agreementId, updatedAt: ts });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
  }
  const claimed = await heads(repo).findOneAndUpdate(
    { _id: agreementId, openAmendmentId: { $exists: false } },
    { $set: { openAmendmentId: amendmentId, updatedAt: ts } },
  );
  return !!claimed;
};

/** Frees the agreement, if this amendment holds it. */
export const releaseAgreement = async (
  repo: TenantRepo,
  agreementId: string,
  amendmentId: string,
  at: Date,
): Promise<void> => {
  await heads(repo).updateOne(
    { _id: agreementId, openAmendmentId: amendmentId },
    { $unset: { openAmendmentId: '' }, $set: { updatedAt: at.toISOString() } },
  );
};

export const openAmendmentOf = async (
  repo: TenantRepo,
  agreementId: string,
): Promise<string | undefined> =>
  (await heads(repo).findOne({ _id: agreementId }))?.openAmendmentId;

const policyId = (repo: TenantRepo) => `amendment-policy:${repo.companyId}`;

export const loadPolicy = async (repo: TenantRepo): Promise<AmendmentPolicy> => {
  const doc = await policies(repo).findOne({ _id: policyId(repo) });
  if (!doc) return DEFAULT_AMENDMENT_POLICY;
  return {
    approveCredits: doc.approveCredits,
    approveAdjustments: doc.approveAdjustments,
    approveAboveCents: doc.approveAboveCents,
  };
};

export const savePolicy = async (
  repo: TenantRepo,
  policy: AmendmentPolicy,
  byName: string,
  at: Date,
): Promise<AmendmentPolicy> => {
  await policies(repo).updateOne(
    { _id: policyId(repo) },
    { $set: { ...policy, updatedByName: byName, updatedAt: at.toISOString() } },
    { upsert: true },
  );
  return loadPolicy(repo);
};
