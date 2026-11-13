import { PaymentKind, PaymentMethod } from '@homepact/shared';
import { describe, expect, it } from 'vitest';
import { toAgreement } from '../../../src/modules/agreements/store.js';
import { renderReceiptPdf } from '../../../src/modules/payments/receipt.js';
import { agreementDoc, paymentDoc } from '../../support/fixtures.js';

/** The text of an uncompressed PDF, one line per text run, as Windows-1252. */
const textOf = (pdf: Buffer): string =>
  [...pdf.toString('latin1').matchAll(/\[([^\]]*)\] TJ/g)]
    .map((m) =>
      [...m[1]!.matchAll(/<([0-9a-f]*)>/g)]
        .map((h) => Buffer.from(h[1]!, 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n');

const agreement = toAgreement(
  agreementDoc({
    home: { kind: 'inventory', model: 'Linden', address: '73 Sunvale Gardens SE' },
  }),
);

describe('renderReceiptPdf', () => {
  it('says who paid whom, how much, when and how, and for which agreement', async () => {
    const pdf = await renderReceiptPdf(
      { agreement, payment: paymentDoc({ reviewedAt: '2026-10-31T09:00:00.000Z' }) },
      { compress: false },
    );
    const text = textOf(pdf);
    for (const expected of [
      'Company A',
      'Payment receipt',
      'Receipt PAY-AAAA-0001',
      'Received from',
      'Bea Buyer',
      '$10,000',
      'October 30, 2026',
      'Cheque #101',
      'Purchase agreement A-TEST-0001',
      'Linden, 73 Sunvale Gardens SE',
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it('money sent back reads as a refund confirmation, to the buyer', async () => {
    const pdf = await renderReceiptPdf(
      {
        agreement,
        payment: paymentDoc({
          kind: PaymentKind.Refund,
          method: PaymentMethod.Wire,
          externalRef: undefined,
        }),
      },
      { compress: false },
    );
    const text = textOf(pdf);
    expect(text).toContain('Refund confirmation');
    expect(text).toContain('Refunded to');
    expect(text).toContain('Wire transfer');
    expect(text).not.toContain('Received from');
  });

  it('the same receipt always renders to the same bytes', async () => {
    const render = () => renderReceiptPdf({ agreement, payment: paymentDoc() });
    expect((await render()).equals(await render())).toBe(true);
  });
});
