import { AgreementStatus, Party, SignerStatus } from '@homepact/shared';
import { describe, expect, it } from 'vitest';
import {
  agreementOfProposal,
  allSigned,
  fileBytes,
  invalidateSignatures,
  signedCount,
  toAgreement,
  toAgreementSummary,
  voidAgreement,
} from '../../../src/modules/agreements/store.js';
import { agreementDoc, purchaserDoc, signature, signedPurchaser } from '../../support/fixtures.js';
import { NOW, NOW_ISO, mockRepo } from '../../support/mocks.js';

describe('toAgreement', () => {
  it('exposes _id as id, never the company or where the PDF is stored', () => {
    const out = toAgreement(
      agreementDoc({ executedPdf: { fileId: 'file-1', sha256: 'abc', size: 42 } }),
    );
    expect(out).toMatchObject({ id: 'agr-1', reference: 'A-TEST-0001' });
    expect(out.executedPdf).toEqual({ sha256: 'abc', size: 42 });
    expect(out).not.toHaveProperty('_id');
    expect(out).not.toHaveProperty('companyId');
    expect(toAgreement(agreementDoc())).not.toHaveProperty('executedPdf');
  });

  it('tells a purchaser on a signing link which signer they are', () => {
    expect(toAgreement(agreementDoc(), 'pur-1')).toMatchObject({ viewerPurchaserId: 'pur-1' });
    expect(toAgreement(agreementDoc())).not.toHaveProperty('viewerPurchaserId');
  });
});

describe('signature counts', () => {
  it('counts signatures of the current content only', () => {
    const purchasers = [
      signedPurchaser({ id: 'a' }),
      purchaserDoc({ id: 'b', status: SignerStatus.Invalidated }),
      purchaserDoc({ id: 'c' }),
    ];
    expect(signedCount(purchasers)).toBe(1);
    expect(allSigned(purchasers)).toBe(false);
    expect(allSigned([signedPurchaser({ id: 'a' }), signedPurchaser({ id: 'b' })])).toBe(true);
    expect(allSigned([])).toBe(false);
  });

  it('invalidates signatures, keeping them for the record', () => {
    const { purchasers, invalidated } = invalidateSignatures(
      [signedPurchaser({ id: 'a' }), purchaserDoc({ id: 'b' })],
      NOW,
    );
    expect(invalidated).toBe(1);
    expect(purchasers).toEqual([
      {
        ...signedPurchaser({ id: 'a' }),
        status: SignerStatus.Invalidated,
        invalidatedAt: NOW_ISO,
      },
      purchaserDoc({ id: 'b' }),
    ]);
    expect(purchasers[0]?.signature).toEqual(signature());
  });
});

describe('voidAgreement', () => {
  it('cancels an agreement that is not executed and voids its signatures', async () => {
    const repo = mockRepo();
    const agreements = repo.col('agreements');
    agreements.findOneAndUpdate.mockImplementation(async (_f, u: { $set: object }) => ({
      ...agreementDoc(),
      ...u.$set,
    }));
    const current = agreementDoc({
      status: AgreementStatus.Signed,
      purchasers: [signedPurchaser()],
    });
    const doc = await voidAgreement(repo, current, NOW, {
      reason: 'The price changed',
      byName: 'Sam Staff',
    });
    expect(doc).toMatchObject({
      status: AgreementStatus.Cancelled,
      cancelReason: 'The price changed',
      cancelledByName: 'Sam Staff',
      cancelledAt: NOW_ISO,
    });
    expect(agreements.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'agr-1',
        status: {
          $in: [AgreementStatus.Draft, AgreementStatus.UnderReview, AgreementStatus.Signed],
        },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          purchasers: [expect.objectContaining({ status: SignerStatus.Invalidated })],
        }),
      }),
    );

    await voidAgreement(repo, current, NOW, {});
    const $set = agreements.findOneAndUpdate.mock.calls.at(-1)![1].$set;
    expect($set).not.toHaveProperty('cancelReason');
    expect($set).not.toHaveProperty('cancelledByName');
  });
});

describe('toAgreementSummary', () => {
  it('is the list row of an agreement', () => {
    expect(toAgreementSummary(agreementDoc())).toEqual({
      id: 'agr-1',
      reference: 'A-TEST-0001',
      status: AgreementStatus.Draft,
      proposalId: 'proposal-1',
      proposalReference: 'P-AAAA-BBBB',
      buyerName: 'Bea Buyer',
      houseName: 'The Aspen',
      totalCents: 50_000_000,
      currency: 'CAD',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      signedCount: 0,
      purchaserCount: 1,
    });
    expect(
      toAgreementSummary(
        agreementDoc({
          home: { kind: 'inventory', model: 'The Aspen', address: '12 Main St' },
          purchasers: [signedPurchaser({ id: 'a' }), purchaserDoc({ id: 'b' })],
          issuedAt: 'i',
          signedAt: 's',
          executedAt: 'e',
        }),
      ),
    ).toMatchObject({
      address: '12 Main St',
      issuedAt: 'i',
      signedAt: 's',
      executedAt: 'e',
      signedCount: 1,
      purchaserCount: 2,
    });
  });
});

describe('fileBytes', () => {
  it('reads stored bytes whether the driver returns a Buffer or a BSON Binary', () => {
    const bytes = Buffer.from('%PDF-1.3');
    expect(fileBytes(bytes).equals(bytes)).toBe(true);
    const view = new Uint8Array([0, 0x25, 0x50, 0x44, 0x46, 0]).subarray(1, 5);
    expect(fileBytes({ buffer: view }).toString()).toBe('%PDF');
  });
});

describe('agreementOfProposal', () => {
  it('staff see the live agreement in any state; buyers only once it was sent', async () => {
    const repo = mockRepo();
    const agreements = repo.col('agreements');
    expect(await agreementOfProposal(repo, undefined, Party.Seller)).toBeUndefined();
    expect(agreements.findOne).not.toHaveBeenCalled();

    agreements.findOne.mockResolvedValue(agreementDoc());
    expect(await agreementOfProposal(repo, 'agr-1', Party.Seller)).toMatchObject({ id: 'agr-1' });
    expect(agreements.findOne).toHaveBeenCalledWith({ _id: 'agr-1' });
    expect(await agreementOfProposal(repo, 'agr-1', Party.Buyer)).toBeUndefined();

    agreements.findOne.mockResolvedValue(
      agreementDoc({ status: AgreementStatus.UnderReview, issuedAt: 'x' }),
    );
    expect(await agreementOfProposal(repo, 'agr-1', Party.Buyer)).toMatchObject({
      status: AgreementStatus.UnderReview,
    });

    agreements.findOne.mockResolvedValue(null);
    expect(await agreementOfProposal(repo, 'gone', Party.Seller)).toBeUndefined();
  });
});
