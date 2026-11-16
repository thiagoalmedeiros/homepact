import {
  AmendmentStatus,
  ChangeDecision,
  formatMoney,
  formatPercent,
  SignerStatus,
  type AgreementSignature,
  type Amendment,
} from '@homepact/shared';
import PDFDocument from 'pdfkit';
import { AGREEMENT_TEXT } from '../../messages.js';
import { longDate, utcStamp } from '../agreements/document.js';
import { winAnsi, type PdfOptions } from '../agreements/pdf.js';

const TEXT = AGREEMENT_TEXT.amendment;
const PDF_TEXT = AGREEMENT_TEXT.pdf;
const FONT = { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' } as const;
const MONO = 'Courier';
const INK = '#1d1d1f';
const MUTED = '#6e6e73';
const RULE = '#d2d2d7';
const WATERMARK = '#aeaeb2';

const CLOSED: readonly AmendmentStatus[] = [
  AmendmentStatus.Declined,
  AmendmentStatus.Withdrawn,
  AmendmentStatus.Rejected,
];

/** The amendment's latest event, so a PDF never depends on when it is rendered. */
const documentDate = (a: Amendment): string =>
  a.executedAt ?? a.closedAt ?? a.signedAt ?? a.issuedAt ?? a.pricedAt ?? a.createdAt;

const statusLine = (a: Amendment): string => {
  switch (a.status) {
    case AmendmentStatus.Requested:
      return TEXT.status.requested;
    case AmendmentStatus.Priced:
      return TEXT.status.priced;
    case AmendmentStatus.UnderReview:
      return TEXT.status.under_review(longDate(a.issuedAt ?? a.updatedAt));
    case AmendmentStatus.AwaitingApproval:
      return TEXT.status.awaiting_approval;
    case AmendmentStatus.Executed:
      return TEXT.status.executed(longDate(a.executedAt ?? a.updatedAt));
    default:
      return TEXT.status.closed(longDate(a.closedAt ?? a.updatedAt));
  }
};

const watermarkOf = (a: Amendment): string | null =>
  CLOSED.includes(a.status)
    ? TEXT.watermark.closed
    : a.status === AmendmentStatus.Requested || a.status === AmendmentStatus.Priced
      ? TEXT.watermark.draft
      : null;

interface Signer {
  title: string;
  role: string;
  signature?: AgreementSignature | undefined;
}

/** The purchasers, whoever sent it for the company, then the approval when one is needed;
 * signatures invalidated by a change are not printed. */
const signersOf = (a: Amendment): Signer[] => [
  ...a.purchasers.map((p, i) => ({
    title: TEXT.purchaser(i + 1, a.purchasers.length, p.name),
    role: PDF_TEXT.roleBuyer,
    ...(p.status === SignerStatus.Signed && { signature: p.signature }),
  })),
  {
    title: TEXT.forTheSeller(a.issuedBy?.name),
    role: TEXT.roleSeller,
    signature: a.sellerSignature,
  },
  ...(a.approval?.required || a.approvalSignature
    ? [
        {
          title: TEXT.approvedBy(a.approvedBy?.name),
          role: TEXT.roleApprover,
          signature: a.approvalSignature,
        },
      ]
    : []),
];

/** Renders a change order: what it amends, each change and its price, the price and deposit
 * schedule before and after, the signatures and their certificate. Reproducible to the byte. */
export const renderAmendmentPdf = (a: Amendment, { compress = true }: PdfOptions = {}) => {
  const title = TEXT.title(a.number, a.agreementReference);
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 64, bottom: 72, left: 64, right: 64 },
    bufferPages: true,
    compress,
    info: {
      Title: winAnsi(`${title} (${a.reference})`),
      Author: winAnsi(a.seller.name),
      Subject: winAnsi(TEXT.subject(a.reference)),
      Creator: PDF_TEXT.creator,
      CreationDate: new Date(documentDate(a)),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const t = winAnsi;
  const money = (cents: number) => formatMoney(cents, a.currency);
  const signedMoney = (cents: number) =>
    cents > 0 ? `+${money(cents)}` : cents < 0 ? `-${money(-cents)}` : money(0);
  const left = () => doc.page.margins.left;
  const width = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };
  const rule = () => {
    doc.moveDown(0.6);
    doc
      .moveTo(left(), doc.y)
      .lineTo(left() + width(), doc.y)
      .lineWidth(0.6)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.9);
  };
  const heading = (text: string, size = 12) => {
    ensure(40);
    doc.moveDown(0.4);
    doc.font(FONT.bold).fontSize(size).fillColor(INK).text(t(text), left(), doc.y);
    doc.moveDown(0.4);
  };
  const paragraph = (text: string, { muted = false, size = 10 } = {}) =>
    doc
      .font(FONT.regular)
      .fontSize(size)
      .fillColor(muted ? MUTED : INK)
      .text(t(text), left(), doc.y, { width: width(), lineGap: 2 });
  const label = (text: string, x = left(), y = doc.y, w = width()) =>
    doc
      .font(FONT.bold)
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(t(text.toUpperCase()), x, y, { width: w, characterSpacing: 0.6 });
  const columns = (render: (x: number, w: number, side: 0 | 1) => void) => {
    const gap = 28;
    const w = (width() - gap) / 2;
    const top = doc.y;
    let lowest = top;
    for (const side of [0, 1] as const) {
      doc.x = left() + side * (w + gap);
      doc.y = top;
      render(doc.x, w, side);
      lowest = Math.max(lowest, doc.y);
    }
    doc.x = left();
    doc.y = lowest;
  };
  const amountWidth = 120;
  const row = (text: string, value: string, opts: { bold?: boolean; muted?: boolean } = {}) => {
    doc.font(opts.bold ? FONT.bold : FONT.regular).fontSize(opts.bold ? 11 : 10);
    const labelWidth = width() - amountWidth - 12;
    const height = Math.max(
      doc.heightOfString(t(text), { width: labelWidth }),
      doc.heightOfString(t(value), { width: amountWidth }),
    );
    ensure(height + 5);
    const y = doc.y;
    doc.fillColor(opts.muted ? MUTED : INK).text(t(text), left(), y, { width: labelWidth });
    doc.text(t(value), left() + width() - amountWidth, y, { width: amountWidth, align: 'right' });
    doc.x = left();
    doc.y = y + height + 5;
  };

  const drawHeader = () => {
    doc
      .font(FONT.bold)
      .fontSize(15)
      .fillColor(INK)
      .text(t(a.seller.name), left(), doc.page.margins.top, { width: width() });
    const contact = [a.seller.address, a.seller.phone, a.seller.email]
      .filter(Boolean)
      .join('  ·  ');
    if (contact) doc.font(FONT.regular).fontSize(8.5).fillColor(MUTED).text(t(contact));
    rule();
    doc.font(FONT.bold).fontSize(19).fillColor(INK).text(t(title), { width: width() });
    doc.moveDown(0.35);
    paragraph(TEXT.meta(a.reference, longDate(documentDate(a))), { muted: true, size: 9 });
    paragraph(statusLine(a), { muted: true, size: 9 });
    rule();
    drawParties();
    paragraph(
      a.basis.number === 0
        ? TEXT.amendsSigned(a.agreementReference, a.basis.contentHash)
        : TEXT.amendsAmended(a.agreementReference, a.basis.number, a.basis.contentHash),
    );
    doc.moveDown(0.4);
    paragraph(TEXT.unchanged);
  };

  /** Who and what: the seller, every purchaser, the home and the agreement it belongs to. */
  const drawParties = () => {
    columns((x, w, side) => {
      if (side === 0) {
        label(TEXT.seller, x, doc.y, w);
        doc.moveDown(0.2);
        doc
          .font(FONT.bold)
          .fontSize(10.5)
          .fillColor(INK)
          .text(t(a.seller.name), x, doc.y, { width: w });
        doc.font(FONT.regular).fontSize(9);
        for (const line of [a.seller.address, a.seller.phone, a.seller.email]) {
          if (line) doc.text(t(line), x, doc.y, { width: w });
        }
      } else {
        label(TEXT.purchasers, x, doc.y, w);
        doc.moveDown(0.2);
        for (const p of a.purchasers) {
          doc.font(FONT.bold).fontSize(10.5).fillColor(INK).text(t(p.name), x, doc.y, { width: w });
          doc.font(FONT.regular).fontSize(9);
          for (const line of [p.email, p.phone])
            if (line) doc.text(t(line), x, doc.y, { width: w });
        }
      }
    });
    doc.moveDown(0.8);
    label(TEXT.home);
    doc.moveDown(0.2);
    doc
      .font(FONT.bold)
      .fontSize(10.5)
      .fillColor(INK)
      .text(
        t([a.home.model, a.home.address, a.home.community].filter(Boolean).join(', ')),
        left(),
        doc.y,
        {
          width: width(),
        },
      );
    paragraph(TEXT.agreementLine(a.agreementReference), { muted: true, size: 9 });
    rule();
  };

  const drawRequest = () => {
    doc.moveDown(0.6);
    paragraph(TEXT.requestedBy(a.requestedBy.name, longDate(a.createdAt)), { size: 9.5 });
    if (a.note) paragraph(TEXT.inTheirWords(a.note), { size: 9.5 });
  };

  const drawChanges = () => {
    drawRequest();
    if (a.changes.length) heading(TEXT.changes);
    for (const c of a.changes) {
      const declined = c.decision === ChangeDecision.Declined;
      row(c.label, declined ? '' : signedMoney(c.deltaCents), { muted: declined });
      if (declined) row(TEXT.notIncluded(c.decisionNote), '', { muted: true });
    }
    if (a.adjustments.length) {
      heading(TEXT.adjustments, 10.5);
      for (const adj of a.adjustments) row(adj.label, signedMoney(adj.amountCents));
    }
    if (a.deposits.length) {
      heading(TEXT.instalments, 10.5);
      for (const d of a.deposits) {
        row(d.dueDate ? `${d.label} (${longDate(d.dueDate)})` : d.label, money(d.amountCents));
      }
    }
    if (a.pricingNote) {
      doc.moveDown(0.4);
      paragraph(a.pricingNote, { muted: true });
    }
    rule();
  };

  const drawPrice = () => {
    const before = a.before.quote;
    const after = a.after?.quote;
    row(TEXT.priceBefore, money(before.totalCents));
    if (!after) return;
    if (after.subtotalCents !== undefined) row(TEXT.priceBeforeTax, money(after.subtotalCents));
    if (after.tax) {
      for (const line of after.tax.lines) {
        row(PDF_TEXT.taxLine(line.label, formatPercent(line.ratePercent)), money(line.amountCents));
      }
    }
    row(TEXT.priceAfter, money(after.totalCents), { bold: true });
    row(TEXT.priceChange, signedMoney(after.totalCents - before.totalCents));
    doc.moveDown(0.3);
    const terms = a.after!.terms;
    if (a.closingDate) {
      const was = a.before.terms.closingDate;
      paragraph(
        TEXT.closingMoved(longDate(a.closingDate), was ? longDate(was) : TEXT.closingToBeConfirmed),
      );
      doc.moveDown(0.3);
    }
    ensure(80);
    doc.moveDown(0.4);
    label(TEXT.schedule);
    doc.moveDown(0.3);
    for (const d of terms.deposits) {
      row(d.dueDate ? `${d.label} (${longDate(d.dueDate)})` : d.label, money(d.amountCents));
    }
    row(TEXT.depositTotal, money(terms.depositCents), { bold: true });
    row(
      TEXT.balanceOn(terms.closingDate && longDate(terms.closingDate)),
      money(after.totalCents - terms.depositCents),
    );
    rule();
  };

  const signers = signersOf(a);
  const drawSignatures = () => {
    heading(TEXT.signatures);
    for (const signer of signers) {
      ensure(80);
      doc.font(FONT.bold).fontSize(10.5).fillColor(INK).text(t(signer.title), left(), doc.y);
      doc.moveDown(0.3);
      const sig = signer.signature;
      if (sig) {
        doc.font(FONT.italic).fontSize(14).fillColor(INK).text(t(sig.fullName), left(), doc.y);
        doc
          .font(FONT.regular)
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(t(PDF_TEXT.signedElectronicallyBy(sig.fullName)), left(), doc.y)
          .text(PDF_TEXT.signedOn(utcStamp(sig.signedAt)), left(), doc.y);
      } else {
        doc.moveDown(1.2);
        doc
          .moveTo(left(), doc.y)
          .lineTo(left() + width() / 2, doc.y)
          .lineWidth(0.6)
          .strokeColor(MUTED)
          .stroke();
        doc.moveDown(0.3);
        doc
          .font(FONT.regular)
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(PDF_TEXT.signatureLine, left(), doc.y);
      }
      doc.moveDown(0.8);
    }
    if (a.contentHash) {
      doc
        .font(FONT.regular)
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(PDF_TEXT.fingerprintNote, left(), doc.y, { width: width() });
      doc.font(MONO).fontSize(7.5).text(PDF_TEXT.fingerprint(a.contentHash), { width: width() });
    }
  };

  const drawCertificate = () => {
    const captured = signers.filter(
      (s): s is Signer & { signature: AgreementSignature } => !!s.signature,
    );
    if (!captured.length) return;
    doc.addPage();
    doc.font(FONT.bold).fontSize(14).fillColor(INK).text(PDF_TEXT.certificateTitle, left(), doc.y);
    doc.moveDown(0.4);
    paragraph(PDF_TEXT.certificateIntro, { muted: true, size: 9 });
    rule();
    const fact = (name: string, value: string, mono = false) => {
      const valueX = left() + 150;
      const valueWidth = width() - 150;
      doc.font(mono ? MONO : FONT.regular).fontSize(9);
      const height = doc.heightOfString(t(value), { width: valueWidth });
      ensure(height + 4);
      const y = doc.y;
      doc.font(FONT.regular).fontSize(9).fillColor(MUTED).text(t(name), left(), y, { width: 145 });
      doc
        .font(mono ? MONO : FONT.regular)
        .fillColor(INK)
        .text(t(value), valueX, y, { width: valueWidth });
      doc.x = left();
      doc.y = y + height + 4;
    };
    fact(PDF_TEXT.documentLabel, `${title} (${a.reference})`);
    if (a.contentHash) fact(PDF_TEXT.documentHash, a.contentHash, true);
    for (const { signature: sig, title: who, role } of captured) {
      doc.moveDown(0.5);
      ensure(90);
      doc
        .font(FONT.bold)
        .fontSize(10.5)
        .fillColor(INK)
        .text(t(`${sig.fullName} (${who})`), left(), doc.y, { width: width() });
      doc.moveDown(0.25);
      fact(PDF_TEXT.roleColumn, role);
      fact(PDF_TEXT.timeColumn, utcStamp(sig.signedAt));
      fact(PDF_TEXT.ipColumn, sig.ip ?? PDF_TEXT.noIp);
      fact(PDF_TEXT.hashColumn, sig.contentHash, true);
      fact(PDF_TEXT.providerColumn, sig.provider);
    }
    if (a.executedAt) {
      rule();
      paragraph(TEXT.certificateFooter(a.reference, utcStamp(a.executedAt)), {
        muted: true,
        size: 9,
      });
    }
  };

  const decoratePages = () => {
    const pages = doc.bufferedPageRange();
    const mark = watermarkOf(a);
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      if (mark) {
        doc.save();
        doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc
          .font(FONT.bold)
          .fontSize(130)
          .fillColor(WATERMARK)
          .fillOpacity(0.22)
          .text(mark, 0, doc.page.height / 2 - 65, {
            width: doc.page.width,
            align: 'center',
            lineBreak: false,
          });
        doc.restore();
      }
      const y = doc.page.height - 46;
      doc
        .font(FONT.regular)
        .fontSize(7.5)
        .fillColor(MUTED)
        .fillOpacity(1)
        .text(t(TEXT.footer(a.seller.name, a.reference)), left(), y, {
          width: width() - 90,
          lineBreak: false,
        })
        .text(PDF_TEXT.page(i + 1, pages.count), left() + width() - 90, y, {
          width: 90,
          align: 'right',
          lineBreak: false,
        });
      doc.page.margins.bottom = margin;
    }
  };

  drawHeader();
  drawChanges();
  drawPrice();
  drawSignatures();
  drawCertificate();
  decoratePages();

  doc.end();
  return done;
};
