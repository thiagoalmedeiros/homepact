import { formatMoney, type Agreement, type AgreementPayment } from '@homepact/shared';
import PDFDocument from 'pdfkit';
import { AGREEMENT_TEXT } from '../../messages.js';
import { longDate } from '../agreements/document.js';
import { winAnsi, type PdfOptions } from '../agreements/pdf.js';

const TEXT = AGREEMENT_TEXT.receipt;
const INK = '#1d1d1f';
const MUTED = '#6e6e73';
const RULE = '#d2d2d7';

export interface ReceiptSource {
  agreement: Pick<Agreement, 'reference' | 'seller' | 'buyer' | 'home' | 'currency'>;
  payment: Pick<
    AgreementPayment,
    | 'reference'
    | 'kind'
    | 'amountCents'
    | 'receivedOn'
    | 'method'
    | 'externalRef'
    | 'recordedAt'
    | 'reviewedAt'
  >;
}

/** One page confirming money received (or refunded) for an agreement. Dated by when the entry
 * was confirmed, so the same entry always renders to the same bytes. */
export const renderReceiptPdf = (
  { agreement: a, payment: p }: ReceiptSource,
  { compress = true }: PdfOptions = {},
): Promise<Buffer> => {
  const confirmedAt = p.reviewedAt ?? p.recordedAt;
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 64, bottom: 72, left: 64, right: 64 },
    compress,
    info: {
      Title: winAnsi(`${TEXT.title[p.kind]} ${p.reference}`),
      Author: winAnsi(a.seller.name),
      Subject: TEXT.subject(p.reference),
      Creator: AGREEMENT_TEXT.pdf.creator,
      CreationDate: new Date(confirmedAt),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const t = winAnsi;
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const rule = () => {
    doc.moveDown(0.6);
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .lineWidth(0.6)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.9);
  };
  const field = (label: string, value: string, size = 11) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(t(label), left, doc.y, { width });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(size).fillColor(INK).text(t(value), left, doc.y, { width });
    doc.moveDown(0.8);
  };

  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(t(a.seller.name), left, doc.y);
  const contact = [a.seller.address, a.seller.phone, a.seller.email].filter(Boolean).join('  ·  ');
  if (contact) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(t(contact));
  rule();
  doc.font('Helvetica-Bold').fontSize(19).fillColor(INK).text(t(TEXT.title[p.kind]));
  doc.moveDown(0.35);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(t(TEXT.meta(p.reference, longDate(confirmedAt))));
  rule();

  field(TEXT.party[p.kind], a.buyer.name);
  field(TEXT.amount[p.kind], formatMoney(p.amountCents, a.currency), 16);
  field(TEXT.date[p.kind], longDate(p.receivedOn));
  field(TEXT.method, [TEXT.methods[p.method], p.externalRef].filter(Boolean).join(' '));
  field(
    TEXT.for,
    `${TEXT.agreement(a.reference)}\n${[a.home.model, a.home.address].filter(Boolean).join(', ')}`,
  );
  rule();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(t(TEXT.note[p.kind](a.seller.name)), {
      width,
    });

  doc.end();
  return done;
};
