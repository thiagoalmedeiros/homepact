import { AccessKeyStatus, AccessResourceType } from '@homepact/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccessKey } from '../../../src/modules/access-keys/keys.js';
import {
  builtInSignatureProvider,
  type SignatureContext,
  type SignatureEnvelope,
} from '../../../src/modules/agreements/signature-provider.js';
import { accessKeyDoc, HASH } from '../../support/fixtures.js';
import { NOW, NOW_ISO, mockRepo, type MockRepo } from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({ randomCode: vi.fn(() => 'ABCD-EFGH') }));
vi.mock('../../../src/modules/access-keys/keys.js', () => ({ createAccessKey: vi.fn() }));

const ENVELOPE: SignatureEnvelope = {
  agreementId: 'agr-1',
  reference: 'A-TEST-0001',
  title: 'Purchase agreement',
  contentHash: HASH,
};

let repo: MockRepo;
let ctx: SignatureContext;
beforeEach(() => {
  repo = mockRepo();
  ctx = { repo, now: NOW, actorId: 'staff-1' };
  let n = 0;
  vi.mocked(createAccessKey).mockImplementation(async () => ({
    key: `plain-key-${++n}`,
    doc: accessKeyDoc(),
  }));
});

describe('the built-in signature provider', () => {
  it('names itself on every signature it captures', () => {
    expect(builtInSignatureProvider.id).toBe('built-in');
  });

  it('gives each signer their own link and code, readable only here', async () => {
    const invitations = await builtInSignatureProvider.invite(ctx, ENVELOPE, [
      { id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' },
      { id: 'pur-2', name: 'Ben Buyer' },
    ]);
    expect(invitations).toEqual([
      {
        purchaserId: 'pur-1',
        name: 'Bea Buyer',
        email: 'bea@buyer.test',
        key: 'plain-key-1',
        code: 'ABCD-EFGH',
      },
      { purchaserId: 'pur-2', name: 'Ben Buyer', key: 'plain-key-2', code: 'ABCD-EFGH' },
    ]);
    expect(createAccessKey).toHaveBeenCalledWith(repo, AccessResourceType.Agreement, 'agr-1', {
      createdBy: 'staff-1',
      now: NOW,
      code: 'ABCD-EFGH',
      signerId: 'pur-1',
    });
  });

  it('revokes every outstanding link of one agreement', async () => {
    await builtInSignatureProvider.revoke(ctx, { agreementId: 'agr-1' });
    expect(repo.col('accessKeys').updateMany).toHaveBeenCalledWith(
      {
        resourceType: AccessResourceType.Agreement,
        resourceId: 'agr-1',
        status: AccessKeyStatus.Active,
      },
      { $set: { status: AccessKeyStatus.Revoked } },
    );
  });

  it('captures who signed, when, from where, and exactly what', async () => {
    const signer = { id: 'pur-1', name: 'Bea Buyer' };
    expect(
      await builtInSignatureProvider.capture(ctx, ENVELOPE, signer, {
        fullName: 'Bea Q. Buyer',
        initials: [3, 1],
        contentHash: HASH,
        ip: '203.0.113.5',
      }),
    ).toEqual({
      fullName: 'Bea Q. Buyer',
      signedAt: NOW_ISO,
      contentHash: HASH,
      ip: '203.0.113.5',
      provider: 'built-in',
      initials: [1, 3],
    });
    const captured = await builtInSignatureProvider.capture(ctx, ENVELOPE, signer, {
      fullName: 'Bea Q. Buyer',
      initials: [],
      contentHash: 'something else',
    });
    expect(captured.contentHash).toBe(HASH);
    expect(captured).not.toHaveProperty('ip');
    expect(captured).not.toHaveProperty('initials');
  });
});
