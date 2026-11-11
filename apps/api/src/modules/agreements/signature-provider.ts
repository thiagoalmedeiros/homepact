import {
  AccessKeyStatus,
  AccessResourceType,
  type AgreementSignature,
  type SignerInvitation,
} from '@homepact/shared';
import { randomCode } from '../../data/ids.js';
import type { TenantRepo } from '../../data/tenant-repo.js';
import { createAccessKey, type AccessKeyDoc } from '../access-keys/keys.js';

export interface SignatureEnvelope {
  agreementId: string;
  reference: string;
  title: string;
  contentHash: string;
}

export interface SignerRef {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface SignatureContext {
  repo: TenantRepo;
  now: Date;
  actorId: string;
}

export interface SignatureSubmission {
  fullName: string;
  initials: number[];
  contentHash: string;
  ip?: string;
}

export interface SignatureProvider {
  readonly id: string;
  /** Invites each signer; the returned credentials are readable exactly once. */
  invite(
    ctx: SignatureContext,
    envelope: SignatureEnvelope,
    signers: SignerRef[],
  ): Promise<SignerInvitation[]>;
  /** Stops outstanding invitations (agreement executed, cancelled or voided). */
  revoke(ctx: SignatureContext, envelope: Pick<SignatureEnvelope, 'agreementId'>): Promise<void>;
  /** Turns a submission into the evidence kept on the agreement. */
  capture(
    ctx: SignatureContext,
    envelope: SignatureEnvelope,
    signer: SignerRef,
    submission: SignatureSubmission,
  ): Promise<AgreementSignature>;
}

export const builtInSignatureProvider: SignatureProvider = {
  id: 'built-in',

  async invite(ctx, envelope, signers) {
    const invitations: SignerInvitation[] = [];
    for (const signer of signers) {
      const code = randomCode();
      const { key } = await createAccessKey(
        ctx.repo,
        AccessResourceType.Agreement,
        envelope.agreementId,
        { createdBy: ctx.actorId, now: ctx.now, code, signerId: signer.id },
      );
      invitations.push({
        purchaserId: signer.id,
        name: signer.name,
        ...(signer.email && { email: signer.email }),
        key,
        code,
      });
    }
    return invitations;
  },

  async revoke(ctx, envelope) {
    await ctx.repo.of<AccessKeyDoc>('accessKeys').updateMany(
      {
        resourceType: AccessResourceType.Agreement,
        resourceId: envelope.agreementId,
        status: AccessKeyStatus.Active,
      },
      { $set: { status: AccessKeyStatus.Revoked } },
    );
  },

  async capture(ctx, envelope, _signer, submission) {
    return {
      fullName: submission.fullName,
      signedAt: ctx.now.toISOString(),
      contentHash: envelope.contentHash,
      ...(submission.ip && { ip: submission.ip }),
      provider: builtInSignatureProvider.id,
      ...(submission.initials.length && {
        initials: [...submission.initials].sort((a, b) => a - b),
      }),
    };
  },
};
