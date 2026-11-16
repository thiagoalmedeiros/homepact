import { AmendmentStatus, ApprovalReason, SignerStatus } from '@homepact/shared';
import { describe, expect, it } from 'vitest';
import { amendmentContentHash } from '../../../src/modules/amendments/document.js';
import { amendmentDoc, purchaserDoc, quote, signature } from '../../support/fixtures.js';
import { NOW_ISO } from '../../support/mocks.js';

describe('amendmentContentHash', () => {
  const base = amendmentDoc();
  const hash = amendmentContentHash(base);

  it('is a SHA-256 that only depends on the content', () => {
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as typeof base;
    expect(amendmentContentHash(reordered)).toBe(hash);
  });

  it('ignores where it stands: status, signatures, approval and history', () => {
    expect(
      amendmentContentHash({
        ...base,
        status: AmendmentStatus.Executed,
        purchasers: [purchaserDoc({ status: SignerStatus.Signed, signature: signature() })],
        sellerSignature: signature(),
        approval: { required: true, reasons: [ApprovalReason.Credit] },
        history: [],
        executedAt: NOW_ISO,
        updatedAt: '2027-01-01T00:00:00.000Z',
      }),
    ).toBe(hash);
  });

  it('changes with anything signed: price, terms, parties, decisions and what it amends', () => {
    const variants = [
      {
        after: {
          ...base.after!,
          quote: quote({ totalCents: 50_800_001, subtotalCents: 50_800_001 }),
        },
      },
      { deposits: [{ label: 'Upgrade payment', amountCents: 1 }] },
      { adjustments: [{ label: 'Fee', amountCents: 1 }] },
      { purchasers: [purchaserDoc({ name: 'Bea Q. Buyer' })] },
      { changes: [{ ...base.changes[0]!, decision: undefined }] },
      { basis: { number: 1, contentHash: 'b'.repeat(64) } },
      { number: 2 },
      { pricingNote: 'Oak in the hall only' },
      { closingDate: '2027-06-30' },
    ];
    for (const over of variants) {
      expect(amendmentContentHash({ ...base, ...over }), JSON.stringify(over)).not.toBe(hash);
    }
  });
});
