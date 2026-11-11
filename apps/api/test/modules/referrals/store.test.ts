import { beforeEach, describe, expect, it } from 'vitest';
import { applyReferral } from '../../../src/modules/referrals/store.js';
import { referralProgramDoc } from '../../support/fixtures.js';
import { mockRepo, type MockRepo } from '../../support/mocks.js';

let repo: MockRepo;
const programs = () => repo.col('referralPrograms');

beforeEach(() => {
  repo = mockRepo();
});

describe('applyReferral', () => {
  const input = {
    programId: 'prog-1',
    referrerName: 'Jo Homeowner',
    referrerEmail: 'jo@example.com',
  };

  it('a new referral takes the name and the current credit of an active program', async () => {
    programs().findOne.mockResolvedValue(referralProgramDoc());
    expect(await applyReferral(repo, input)).toEqual({
      programId: 'prog-1',
      programName: 'Refer a friend',
      referrerName: 'Jo Homeowner',
      referrerEmail: 'jo@example.com',
      creditCents: 200_000,
    });
    expect(programs().findOne).toHaveBeenCalledWith({ _id: 'prog-1', active: true });
  });

  it('an unknown or ended program is a 422', async () => {
    await expect(applyReferral(repo, input)).rejects.toMatchObject({
      status: 422,
      message: 'This referral program does not exist or is no longer active',
    });
  });

  it('a referral already on the proposal keeps its promised credit; the referrer can change', async () => {
    const current = {
      programId: 'prog-1',
      programName: 'Refer a friend (2026)',
      referrerName: 'Jo Homeowner',
      referrerEmail: 'jo@example.com',
      creditCents: 150_000,
    };
    expect(
      await applyReferral(
        repo,
        { programId: 'prog-1', referrerName: 'Jo H. Homeowner', referrerPhone: '555-0101' },
        current,
      ),
    ).toEqual({
      programId: 'prog-1',
      programName: 'Refer a friend (2026)',
      referrerName: 'Jo H. Homeowner',
      referrerPhone: '555-0101',
      creditCents: 150_000,
    });
    expect(programs().findOne).not.toHaveBeenCalled();

    programs().findOne.mockResolvedValue(referralProgramDoc({ _id: 'prog-2', creditCents: 0 }));
    expect(await applyReferral(repo, { ...input, programId: 'prog-2' }, current)).toMatchObject({
      programId: 'prog-2',
      creditCents: 0,
    });
  });
});
