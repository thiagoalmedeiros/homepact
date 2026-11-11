import {
  AgreementStatus,
  OPEN_AGREEMENT_STATUSES,
  Party,
  SignerStatus,
  type AgreementPurchaser,
  type ProposalParty,
  type Agreement,
  type AgreementSummary,
} from '@homepact/shared';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';

export interface AgreementDoc
  extends TenantDoc, Omit<Agreement, 'id' | 'executedPdf' | 'viewerPurchaserId'> {
  executedPdf?: { fileId: string; sha256: string; size: number };
}

export interface AgreementFileDoc extends TenantDoc {
  agreementId: string;
  kind: 'executed';
  contentType: 'application/pdf';
  data: Uint8Array | { buffer: Uint8Array };
  sha256: string;
  size: number;
  createdAt: string;
}

export const signedCount = (purchasers: AgreementPurchaser[]): number =>
  purchasers.filter((p) => p.status === SignerStatus.Signed).length;

/** True once every purchaser has signed the current content. */
export const allSigned = (purchasers: AgreementPurchaser[]): boolean =>
  purchasers.length > 0 && purchasers.every((p) => p.status === SignerStatus.Signed);

/** Sets those who had signed back to "invalidated", keeping their old signature for the record. */
export const invalidateSignatures = (
  purchasers: AgreementPurchaser[],
  at: Date,
): { purchasers: AgreementPurchaser[]; invalidated: number } => {
  let invalidated = 0;
  const next = purchasers.map((p) => {
    if (p.status !== SignerStatus.Signed) return p;
    invalidated++;
    return { ...p, status: SignerStatus.Invalidated, invalidatedAt: at.toISOString() };
  });
  return { purchasers: next, invalidated };
};

export const toAgreement = (d: AgreementDoc, viewerPurchaserId?: string): Agreement => {
  const { _id, companyId: _c, executedPdf, ...rest } = d;
  return {
    id: _id,
    ...rest,
    ...(executedPdf && { executedPdf: { sha256: executedPdf.sha256, size: executedPdf.size } }),
    ...(viewerPurchaserId && { viewerPurchaserId }),
  };
};

export const toAgreementSummary = (d: AgreementDoc): AgreementSummary => ({
  id: d._id,
  reference: d.reference,
  status: d.status,
  proposalId: d.proposalId,
  proposalReference: d.proposalReference,
  buyerName: d.buyer.name,
  houseName: d.home.model,
  ...(d.home.address && { address: d.home.address }),
  totalCents: d.quote.totalCents,
  currency: d.currency,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  ...(d.issuedAt && { issuedAt: d.issuedAt }),
  ...(d.signedAt && { signedAt: d.signedAt }),
  ...(d.executedAt && { executedAt: d.executedAt }),
  signedCount: signedCount(d.purchasers),
  purchaserCount: d.purchasers.length,
});

export const fileBytes = (data: AgreementFileDoc['data']): Buffer => {
  const bytes = data instanceof Uint8Array ? data : data.buffer;
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};

/** Voids an agreement that is not executed; its signatures no longer count. Null if it moved on
 * meanwhile. */
export const voidAgreement = (
  repo: TenantRepo,
  current: AgreementDoc,
  at: Date,
  why: { reason?: string | undefined; byName?: string },
): Promise<AgreementDoc | null> => {
  const ts = at.toISOString();
  return repo.of<AgreementDoc>('agreements').findOneAndUpdate(
    { _id: current._id, status: { $in: [...OPEN_AGREEMENT_STATUSES] } },
    {
      $set: {
        status: AgreementStatus.Cancelled,
        purchasers: invalidateSignatures(current.purchasers, at).purchasers,
        cancelledAt: ts,
        ...(why.byName && { cancelledByName: why.byName }),
        ...(why.reason && { cancelReason: why.reason }),
        updatedAt: ts,
      },
    },
  );
};

/** The agreement a proposal page shows: to staff always, to buyers once it has been sent. */
export const agreementOfProposal = async (
  repo: TenantRepo,
  agreementId: string | undefined,
  viewer: ProposalParty,
): Promise<AgreementSummary | undefined> => {
  if (!agreementId) return undefined;
  const doc = await repo.of<AgreementDoc>('agreements').findOne({ _id: agreementId });
  if (!doc || (viewer === Party.Buyer && !doc.issuedAt)) return undefined;
  return toAgreementSummary(doc);
};
