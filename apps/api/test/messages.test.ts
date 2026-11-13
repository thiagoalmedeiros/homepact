import { describe, expect, it } from 'vitest';
import { AGREEMENT_TEXT, CHANGE_LABELS, ERRORS, NAMES, THREAD } from '../src/messages.js';

/** Every leaf of a messages tree: strings, or builder functions. */
const leaves = (node: object): unknown[] =>
  Object.values(node).flatMap((v) => (v && typeof v === 'object' ? leaves(v) : [v]));

describe('messages', () => {
  it('every constant is non-empty text or a builder', () => {
    for (const tree of [ERRORS, NAMES, THREAD, CHANGE_LABELS, AGREEMENT_TEXT]) {
      for (const leaf of leaves(tree)) {
        if (typeof leaf === 'string') expect(leaf.trim()).not.toBe('');
        else expect(typeof leaf).toBe('function');
      }
    }
  });

  it('system messages pluralise and include optional parts only when present', () => {
    expect(THREAD.proposed('Sam', 'Aspen', undefined, '$1')).toBe(
      'Sam proposed Aspen: revision 1, $1.',
    );
    expect(THREAD.proposed('Sam', 'Aspen', '12 Main St', '$1')).toBe(
      'Sam proposed Aspen at 12 Main St: revision 1, $1.',
    );
    expect(THREAD.changesRequested('Bea', 1, 2, '$3')).toBe(
      'Bea requested 1 change to revision 2 ($3 if all approved).',
    );
    expect(THREAD.changesRequested('Bea', 2, 2, '$3')).toBe(
      'Bea requested 2 changes to revision 2 ($3 if all approved).',
    );
    expect(THREAD.decided('Sam', 1, 2, 3, '$4', true)).toBe(
      'Sam approved 1 of 2 requested changes. Revision 3: $4.',
    );
    expect(THREAD.decided('Sam', 0, 1, 2, '$4', false)).toBe(
      'Sam approved 0 of 1 requested change. Revision 2 stands at $4.',
    );
    expect(THREAD.agreementCancelled('Sam', 'A-1')).toBe('Sam cancelled purchase agreement A-1.');
    expect(THREAD.agreementCancelled('Sam', 'A-1', 'Wrong date.')).toBe(
      'Sam cancelled purchase agreement A-1. Wrong date.',
    );
    expect(THREAD.agreementSigned('Bea', 'A-1', 1, 2)).toBe(
      'Bea signed purchase agreement A-1 (1 of 2 purchasers).',
    );
    expect(THREAD.agreementSigned('Bea', 'A-1', 1, 1)).toBe(
      'Bea signed purchase agreement A-1 (1 of 1 purchaser).',
    );
    expect(THREAD.paymentReceived('$5', 'A-1', '2026-10-31')).toBe(
      'Payment of $5 received on 2026-10-31 for purchase agreement A-1.',
    );
    expect(THREAD.refundIssued('$5', 'A-1', '2026-10-31')).toBe(
      'Refund of $5 issued on 2026-10-31 for purchase agreement A-1.',
    );
    expect(THREAD.agreementAmended('Sam', 'A-1', 0)).toBe('Sam changed purchase agreement A-1.');
    expect(THREAD.agreementAmended('Sam', 'A-1', 1)).toBe(
      'Sam changed purchase agreement A-1; 1 signature is no longer valid and must be given again.',
    );
    expect(THREAD.agreementAmended('Sam', 'A-1', 2)).toBe(
      'Sam changed purchase agreement A-1; 2 signatures are no longer valid and must be given again.',
    );
  });

  it('parameterised errors and agreement wording', () => {
    expect(ERRORS.catalog.unknownArea('patio')).toBe('Unknown area "patio"');
    expect(CHANGE_LABELS.switchPackage('Kitchen', 'Standard', 'Signature')).toBe(
      'Change Kitchen: Standard → Signature',
    );
    expect(AGREEMENT_TEXT.pdf.page(2, 3)).toBe('Page 2 of 3');
    expect(AGREEMENT_TEXT.pdf.status.signed('May 1, 2027')).toBe(
      'Signed by every purchaser on May 1, 2027; waiting for the Seller to countersign.',
    );
    expect(AGREEMENT_TEXT.pdf.status.executed('May 2, 2027')).toBe(
      'Executed on May 2, 2027: signed by every party.',
    );
    expect(AGREEMENT_TEXT.pdf.purchaser(1, 1)).toBe('Purchaser');
    expect(AGREEMENT_TEXT.pdf.purchaser(2, 3)).toBe('Purchaser 2 of 3');
    expect(AGREEMENT_TEXT.instalment('$10,000', 'on signing')).toBe('$10,000 on signing');
    expect(AGREEMENT_TEXT.instalment('$10,000', 'on signing', 'May 1, 2027')).toBe(
      '$10,000 on signing (due May 1, 2027)',
    );
    expect(AGREEMENT_TEXT.condition('Financing')).toBe('Financing');
    expect(AGREEMENT_TEXT.condition('Financing', 'A mortgage.', 'May 1, 2027')).toBe(
      'Financing: A mortgage. (by May 1, 2027)',
    );
  });
});
