import {
  AmendmentStatus,
  ApprovalReason,
  ChangeDecision,
  Role,
  SignerStatus,
} from '@homepact/shared';
import { describe, expect, it } from 'vitest';
import { renderAmendmentPdf } from '../../../src/modules/amendments/pdf.js';
import { toAmendment } from '../../../src/modules/amendments/store.js';
import { amendmentDoc, purchaserDoc, signature, TERMS } from '../../support/fixtures.js';
import { NOW_ISO } from '../../support/mocks.js';

/** The text of an uncompressed PDF, one line per text run, as Windows-1252. */
const textOf = (pdf: Buffer): string =>
  [...pdf.toString('latin1').matchAll(/\[([^\]]*)\] TJ/g)]
    .map((m) =>
      [...m[1]!.matchAll(/<([0-9a-f]*)>/g)]
        .map((h) => Buffer.from(h[1]!, 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n');
const flat = (pdf: Buffer) => textOf(pdf).replace(/\s+/g, ' ');

const ADMIN = { id: 'admin-1', name: 'Alex Admin', role: Role.CompanyAdmin };

const executed = () =>
  toAmendment(
    amendmentDoc({
      status: AmendmentStatus.Executed,
      changes: [
        amendmentDoc().changes[0]!,
        {
          id: 'chg-2',
          change: { type: 'add_item', areaSlug: 'kitchen', itemId: 'item-island' },
          label: 'Add Island (Kitchen)',
          deltaCents: 500_000,
          decision: ChangeDecision.Declined,
          decisionNote: 'Not possible with this layout',
        },
      ],
      adjustments: [{ label: 'Change order fee', amountCents: 25_000 }],
      deposits: [{ label: 'Change order payment', amountCents: 400_000, dueDate: '2026-12-01' }],
      after: {
        ...amendmentDoc().after!,
        terms: {
          ...TERMS,
          deposits: [
            ...TERMS.deposits,
            { label: 'Change order payment', amountCents: 400_000, dueDate: '2026-12-01' },
          ],
          depositCents: 2_900_000,
          closingDate: '2027-06-30',
        },
      },
      approval: { required: true, reasons: [ApprovalReason.Adjustment] },
      purchasers: [purchaserDoc({ status: SignerStatus.Signed, signature: signature() })],
      issuedAt: NOW_ISO,
      issuedBy: { id: 'staff-1', name: 'Sam Staff', role: Role.CompanyStaff },
      sellerSignature: signature({ fullName: 'Sam Staff', initials: [] }),
      signedAt: NOW_ISO,
      approvedAt: NOW_ISO,
      approvedBy: ADMIN,
      approvalSignature: signature({ fullName: 'Alex Admin', initials: [] }),
      executedAt: NOW_ISO,
      closingDate: '2027-06-30',
    }),
  );

describe('renderAmendmentPdf (a document that stands on its own)', () => {
  it('names the parties, the home and what the buyer asked for', async () => {
    const text = flat(
      await renderAmendmentPdf(
        toAmendment(
          amendmentDoc({
            note: 'Oak in the living room, please',
            home: {
              kind: 'inventory',
              model: 'The Aspen',
              address: '12 Main St',
              community: 'Riverside',
            },
            purchasers: [
              purchaserDoc(),
              purchaserDoc({ id: 'pur-2', name: 'Ben Buyer', email: 'ben@buyer.test' }),
            ],
          }),
        ),
        { compress: false },
      ),
    );
    for (const expected of [
      'SELLER',
      'Company A',
      '1 Builder Way',
      'PURCHASERS',
      'Bea Buyer',
      'bea@buyer.test',
      'Ben Buyer',
      'THE HOME',
      'The Aspen, 12 Main St, Riverside',
      'Requested by Bea Buyer on October 31, 2026',
      'In their words: Oak in the living room, please',
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it('sets out the whole payment schedule after the change, each instalment with its date', async () => {
    const text = flat(await renderAmendmentPdf(executed(), { compress: false }));
    for (const expected of [
      'PAYMENT SCHEDULE AFTER THIS AMENDMENT',
      'on signing',
      '$25,000',
      'Change order payment (December 1, 2026)',
      '$4,000',
      'Balance due on closing (June 30, 2027)',
      '$479,000',
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it('leaves out the changes heading when only fees, credits or dates change', async () => {
    const text = flat(
      await renderAmendmentPdf(
        toAmendment(
          amendmentDoc({ changes: [], adjustments: [{ label: 'Credit', amountCents: -1 }] }),
        ),
        { compress: false },
      ),
    );
    expect(text).not.toContain('Changes Fees and credits');
    expect(text).toContain('Fees and credits');
  });
});

describe('renderAmendmentPdf', () => {
  it('states what it amends, each change and its price, and the new price and schedule', async () => {
    const text = flat(await renderAmendmentPdf(executed(), { compress: false }));
    for (const expected of [
      'Company A',
      'Amendment 1 to purchase agreement A-TEST-0001',
      'Change order CO-TEST-0001',
      `amends purchase agreement A-TEST-0001 as signed (SHA-256 ${'c0ffee'.padEnd(64, '0')})`,
      'All other terms of the agreement remain unchanged.',
      'Add Oak (Flooring)',
      '$8,000',
      'Add Island (Kitchen)',
      'Not included: Not possible with this layout',
      'Change order fee',
      '$250',
      'Change order payment (December 1, 2026)',
      '$4,000',
      'Purchase price before this amendment',
      '$500,000',
      'Purchase price after this amendment',
      '$508,000',
      'Change in price',
      '+$8,000',
      'Closing and possession: June 30, 2027 (was March 15, 2027)',
      'Deposit, all instalments',
      '$29,000',
      'Executed on October 31, 2026',
      'Signed electronically by Bea Q. Buyer',
      'For the Seller: Sam Staff',
      'Approved for the Seller: Alex Admin',
      `SHA-256 ${'a1'.repeat(32)}`,
      'Certificate of signatures',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('says what it still waits for before it is executed', async () => {
    const priced = flat(await renderAmendmentPdf(toAmendment(amendmentDoc()), { compress: false }));
    expect(priced).toContain('Priced: not yet sent to the purchasers.');
    expect(priced).toContain('Signature, name and date');
    expect(priced).not.toContain('Certificate of signatures');

    const waiting = flat(
      await renderAmendmentPdf(
        toAmendment(
          amendmentDoc({
            status: AmendmentStatus.AwaitingApproval,
            approval: { required: true, reasons: [ApprovalReason.Credit] },
            signedAt: NOW_ISO,
          }),
        ),
        { compress: false },
      ),
    );
    expect(waiting).toContain('Signed by every purchaser; waiting for approval by the Seller.');
  });

  it('renders the same bytes every time', async () => {
    const a = await renderAmendmentPdf(executed());
    const b = await renderAmendmentPdf(executed());
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a.equals(b)).toBe(true);
  });
});
