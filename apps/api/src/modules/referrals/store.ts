import type { QuoteReferral, ReferralInput, ReferralProgram } from '@homepact/shared';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';
import { unprocessable } from '../../http/errors.js';
import { ERRORS } from '../../messages.js';

export interface ReferralProgramDoc extends TenantDoc, Omit<ReferralProgram, 'id'> {}

export const toReferralProgram = ({
  _id,
  companyId: _c,
  ...rest
}: ReferralProgramDoc): ReferralProgram => ({ id: _id, ...rest });

/** The referral a quote is priced with. One already on the proposal keeps its promised credit; a
 * new one takes the current credit of an active program. */
export const applyReferral = async (
  repo: TenantRepo,
  input: ReferralInput,
  current?: QuoteReferral,
): Promise<QuoteReferral> => {
  const referrer = {
    referrerName: input.referrerName,
    ...(input.referrerEmail && { referrerEmail: input.referrerEmail }),
    ...(input.referrerPhone && { referrerPhone: input.referrerPhone }),
  };
  if (current?.programId === input.programId) {
    return {
      programId: current.programId,
      programName: current.programName,
      ...referrer,
      creditCents: current.creditCents,
    };
  }
  const program = await repo
    .of<ReferralProgramDoc>('referralPrograms')
    .findOne({ _id: input.programId, active: true });
  if (!program) throw unprocessable(ERRORS.referrals.unknownProgram);
  return {
    programId: program._id,
    programName: program.name,
    ...referrer,
    creditCents: program.creditCents,
  };
};
