import { AgreementStatus, SignerStatus } from '@homepact/shared';
import { describe, expect, it } from 'vitest';
import { renderAgreementPdf, winAnsi } from '../../../src/modules/agreements/pdf.js';
import { toAgreement } from '../../../src/modules/agreements/store.js';
import { agreementDoc, purchaserDoc, quote, signature } from '../../support/fixtures.js';

/** The text of an uncompressed PDF, one line per text run, as Windows-1252. */
const textOf = (pdf: Buffer): string =>
  [...pdf.toString('latin1').matchAll(/\[([^\]]*)\] TJ/g)]
    .map((m) =>
      [...m[1]!.matchAll(/<([0-9a-f]*)>/g)]
        .map((h) => Buffer.from(h[1]!, 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n');

const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

const agreement = (over: Parameters<typeof agreementDoc>[0] = {}) =>
  toAgreement(
    agreementDoc({
      sections: [
        { heading: 'Parties', body: 'Between Company A and Bea Buyer.' },
        { heading: 'Price', body: 'First paragraph.\n\nSecond paragraph.' },
      ],
      quote: quote({
        lines: [
          {
            areaSlug: 'kitchen',
            areaLabel: 'Kitchen',
            kind: 'package',
            refId: 'pkg',
            name: 'Signature',
            unitCents: 900_000,
          },
          {
            areaSlug: 'kitchen',
            areaLabel: 'Kitchen',
            kind: 'item',
            refId: 'hood',
            name: 'Range hood',
            unitCents: 0,
          },
        ],
        adjustments: [{ label: 'Promo', amountCents: -400_000 }],
        totalCents: 50_500_000,
      }),
      ...over,
    }),
  );

describe('winAnsi', () => {
  it('keeps what the standard fonts can print and replaces the rest', () => {
    expect(winAnsi('Café “Chef’s” — €5 · ½')).toBe('Café “Chef’s” — €5 · ½');
    expect(winAnsi('Standard → Signature ≥ 2')).toBe('Standard -> Signature >= 2');
    expect(winAnsi('Łukasz Wałęsa Dvořák')).toBe('?ukasz Wa?esa Dvorák');
    expect(winAnsi('a\tb\nc 🏠')).toBe('a b\nc ?');
    expect(winAnsi('9\u202fa.m.')).toBe('9 a.m.');
  });
});

describe('renderAgreementPdf', () => {
  it('prints the letterhead, clauses, signatures and Schedule A', async () => {
    const pdf = await renderAgreementPdf(agreement(), { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = textOf(pdf);
    for (const expected of [
      'Company A',
      '1 Builder Way',
      'Purchase agreement for Bea Buyer',
      'Agreement A-TEST-0001',
      'From proposal P-AAAA-BBBB, revision 1',
      'Draft: not yet sent to the purchasers.',
      '1. Parties',
      'Between Company A and Bea Buyer.',
      '2. Price',
      'First paragraph.',
      'Second paragraph.',
      'Signature, name and date',
      `SHA-256 ${agreementDoc().contentHash}`,
      'Schedule A: the home and its price',
      'The Aspen',
      '2,000 sq ft',
      'Signature package',
      'Included',
      'Promo',
      '-$4,000',
      'Purchase price',
      '$505,000',
      'Deposit on signing',
      '$25,000',
      'DEPOSIT SCHEDULE',
      'CONDITIONS',
      'Financing: A mortgage commitment.',
      'February 1, 2027',
      'Balance due on closing',
      '$480,000',
      'March 15, 2027',
      'DRAFT',
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).toMatch(/Page 1 of \d/);
  });

  it('Schedule A shows the referral credit, the price before tax, each tax and the total', async () => {
    const base = agreement().quote;
    const taxed = agreement({
      quote: {
        ...base,
        referral: {
          programId: 'prog-1',
          programName: 'Refer a friend',
          referrerName: 'Jo Homeowner',
          creditCents: 200_000,
        },
        subtotalCents: 50_300_000,
        tax: {
          regionCode: 'ON',
          regionName: 'Ontario',
          lines: [{ label: 'HST', ratePercent: 13, amountCents: 6_539_000 }],
          totalCents: 6_539_000,
        },
        totalCents: 56_839_000,
      },
    });
    const text = textOf(await renderAgreementPdf(taxed, { compress: false }));
    for (const expected of [
      'REFERRAL',
      'Refer a friend credit: referred by Jo Homeowner',
      '-$2,000',
      'Purchase price before tax',
      '$503,000',
      'SALES TAX: ONTARIO (ON)',
      'HST (13%)',
      '$65,390',
      'Purchase price, sales tax included',
      '$568,390',
      '$543,390',
    ]) {
      expect(text, expected).toContain(expected);
    }

    const untaxed = agreement({
      quote: { ...base, subtotalCents: base.totalCents, totalCents: base.totalCents },
    });
    const plain = textOf(await renderAgreementPdf(untaxed, { compress: false }));
    expect(plain).toContain('Purchase price before tax');
    expect(plain).toContain('No sales tax');
    expect(plain).toContain('Purchase price, sales tax included');
    expect(plain).not.toContain('REFERRAL');
  });

  const executed = (over: Parameters<typeof agreementDoc>[0] = {}) =>
    agreement({
      status: AgreementStatus.Executed,
      issuedAt: '2026-11-01T10:00:00.000Z',
      signedAt: '2026-11-02T18:30:00.000Z',
      executedAt: '2026-11-03T09:15:00.000Z',
      purchasers: [
        purchaserDoc({
          id: 'pur-1',
          status: SignerStatus.Signed,
          signature: signature({
            fullName: 'Bea Q. Buyer',
            signedAt: '2026-11-02T18:30:00.000Z',
            ip: '203.0.113.5',
            initials: [2],
          }),
        }),
        purchaserDoc({
          id: 'pur-2',
          name: 'Ben Buyer',
          status: SignerStatus.Signed,
          signature: signature({
            fullName: 'Ben Buyer',
            signedAt: '2026-11-02T19:00:00.000Z',
            ip: '203.0.113.6',
            initials: [2],
          }),
        }),
      ],
      counterSignature: signature({
        fullName: 'Alex Admin',
        signedAt: '2026-11-03T09:15:00.000Z',
        ip: '198.51.100.7',
        initials: [],
      }),
      ...over,
    });

  it('an executed agreement shows every signature and no watermark', async () => {
    const text = textOf(await renderAgreementPdf(executed(), { compress: false }));
    expect(text).toContain('Executed on November 3, 2026: signed by every party.');
    expect(text).toContain('PURCHASER 1 OF 2');
    expect(text).toContain('PURCHASER 2 OF 2');
    expect(text).toContain('Signed electronically by Bea Q. Buyer');
    expect(text).toContain('on 2026-11-02 18:30 UTC');
    expect(text).toContain('Signed electronically by Ben Buyer');
    expect(text).toContain('Signed electronically by Alex Admin');
    expect(text).toContain('Initialled clauses 2');
    expect(text).not.toContain('Signature, name and date');
    expect(text).not.toContain('DRAFT');
    expect(text).not.toContain('VOID');
  });

  it('carries a certificate page with signer, time, IP address and document hash', async () => {
    const pdf = await renderAgreementPdf(executed(), { compress: false });
    const text = textOf(pdf);
    for (const expected of [
      'Certificate of signatures',
      `Purchase agreement for Bea Buyer (A-TEST-0001)`,
      agreementDoc().contentHash,
      'Bea Q. Buyer (Bea Buyer)',
      'Ben Buyer (Ben Buyer)',
      'Alex Admin (Company A)',
      'Purchaser',
      'For the Seller (countersignature)',
      '2026-11-02 18:30 UTC',
      '203.0.113.5',
      '203.0.113.6',
      '198.51.100.7',
      'built-in',
      'Agreement A-TEST-0001 executed 2026-11-03 09:15 UTC.',
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(3);
  });

  it('an unsigned agreement has no certificate page, and says where to sign', async () => {
    const text = textOf(
      await renderAgreementPdf(
        agreement({ status: AgreementStatus.UnderReview, issuedAt: '2026-11-01T10:00:00.000Z' }),
        { compress: false },
      ),
    );
    expect(text).toContain('Signature, name and date');
    expect(text).not.toContain('Certificate of signatures');
  });

  it('a signature that was invalidated by a change no longer prints as signed', async () => {
    const text = textOf(
      await renderAgreementPdf(
        executed({
          status: AgreementStatus.UnderReview,
          purchasers: [
            purchaserDoc({
              status: SignerStatus.Invalidated,
              signature: signature({ fullName: 'Bea Q. Buyer' }),
              invalidatedAt: '2026-11-03T09:15:00.000Z',
            }),
          ],
          counterSignature: undefined,
        }),
        { compress: false },
      ),
    );
    expect(text).toContain('Signature, name and date');
    expect(text).not.toContain('Signed electronically by Bea Q. Buyer');
    expect(text).not.toContain('Certificate of signatures');
  });

  it('a cancelled agreement is marked void on every page', async () => {
    const pdf = await renderAgreementPdf(
      agreement({ status: AgreementStatus.Cancelled, cancelledAt: '2026-11-03T09:00:00.000Z' }),
      { compress: false },
    );
    const text = textOf(pdf);
    expect(text).toContain('Cancelled on November 3, 2026. This agreement is void.');
    expect(text.match(/^VOID$/gm)).toHaveLength(pageCount(pdf));
  });

  it('long agreements flow onto more pages, every one numbered', async () => {
    const sections = Array.from({ length: 30 }, (_, i) => ({
      heading: `Clause ${i}`,
      body: 'The parties agree to this clause. '.repeat(20),
    }));
    const pdf = await renderAgreementPdf(agreement({ sections }), { compress: false });
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(4);
    expect(textOf(pdf)).toContain(`Page ${pages} of ${pages}`);
  });

  it('the same agreement always renders to the same bytes', async () => {
    const a = await renderAgreementPdf(agreement({ status: AgreementStatus.UnderReview }));
    const b = await renderAgreementPdf(agreement({ status: AgreementStatus.UnderReview }));
    expect(a.equals(b)).toBe(true);
    expect(a.toString('latin1')).toContain('(Purchase agreement for Bea Buyer \\(A-TEST-0001\\))');
  });
});
