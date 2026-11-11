import {
  AgreementStatus,
  formatMoney,
  formatPercent,
  SignerStatus,
  type Agreement,
  type AgreementParty,
  type AgreementSignature,
} from '@homepact/shared';
import PDFDocument from 'pdfkit';
import { longDate, theModel, utcStamp } from './document.js';
import { AGREEMENT_TEXT } from '../../messages.js';

const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACEMENTS: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '−': '-',
  '\u2010': '-',
  '\u2011': '-',
  '\u2009': ' ',
  '\u202f': ' ',
  '\u200b': '',
  '✓': 'v',
};
const printable = (ch: string): boolean => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch);
};

/** Fits text to the Windows-1252 PDF fonts: swaps common symbols, drops accents without a form,
 * prints "?" for the rest. */
export const winAnsi = (text: string): string =>
  [...text.normalize('NFC')]
    .map((ch) => {
      if (ch === '\n') return ch;
      const swap = REPLACEMENTS[ch];
      if (swap !== undefined) return swap;
      if (printable(ch)) return ch;
      const c = ch.codePointAt(0)!;
      if (c < 0x20 || (c >= 0x7f && c < 0xa0)) return ' ';
      const bare = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return bare && [...bare].every(printable) ? bare : '?';
    })
    .join('');

const TEXT = AGREEMENT_TEXT.pdf;
const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  mono: 'Courier',
} as const;
const NUMBER_LOCALE = 'en-CA';
const INK = '#1d1d1f';
const MUTED = '#6e6e73';
const RULE = '#d2d2d7';
const WATERMARK = '#aeaeb2';

const statusLine = (a: Agreement): string => {
  switch (a.status) {
    case AgreementStatus.Draft:
      return TEXT.status.draft;
    case AgreementStatus.UnderReview:
      return TEXT.status.under_review(longDate(a.issuedAt ?? a.updatedAt));
    case AgreementStatus.Signed:
      return TEXT.status.signed(longDate(a.signedAt ?? a.updatedAt));
    case AgreementStatus.Executed:
      return TEXT.status.executed(longDate(a.executedAt ?? a.updatedAt));
    case AgreementStatus.Cancelled:
      return TEXT.status.cancelled(longDate(a.cancelledAt ?? a.updatedAt));
  }
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const watermarkOf = (a: Agreement): string | null =>
  a.status === AgreementStatus.Draft
    ? TEXT.watermark.draft
    : a.status === AgreementStatus.Cancelled
      ? TEXT.watermark.cancelled
      : null;

interface Signer {
  name: string;
  role: string;
  signature?: AgreementSignature;
}

export interface PdfOptions {
  compress?: boolean;
}

const HEADING_AND_FIRST_LINES_HEIGHT = 64;

/** The agreement's latest event, so a PDF never depends on when it is rendered. */
const documentDate = (a: Agreement): Date =>
  new Date(a.executedAt ?? a.signedAt ?? a.cancelledAt ?? a.issuedAt ?? a.preparedAt);

/** The purchasers, then the company; signatures invalidated by a change are not printed. */
const signersOf = (a: Agreement): Signer[] => [
  ...a.purchasers.map((p) => ({
    name: p.name,
    role: TEXT.roleBuyer,
    ...(p.status === SignerStatus.Signed && p.signature && { signature: p.signature }),
  })),
  {
    name: a.seller.name,
    role: TEXT.roleSeller,
    ...(a.counterSignature && { signature: a.counterSignature }),
  },
];

/** Renders an agreement: letterhead, clauses, signatures, Schedule A (price before tax, sales tax,
 * total, deposits, conditions) and the certificate of signatures. Reproducible to the byte. */
export const renderAgreementPdf = (a: Agreement, { compress = true }: PdfOptions = {}) => {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 64, bottom: 72, left: 64, right: 64 },
    bufferPages: true,
    compress,
    info: {
      Title: winAnsi(`${a.title} (${a.reference})`),
      Author: winAnsi(a.seller.name),
      Subject: TEXT.subject(a.reference),
      Creator: TEXT.creator,
      CreationDate: documentDate(a),
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
  const writeInBottomMargin = (draw: () => void) => {
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    draw();
    doc.page.margins.bottom = margin;
  };
  const signers = signersOf(a);

  const drawLetterhead = () => {
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
  };
  const drawTitle = () => {
    doc.font(FONT.bold).fontSize(19).fillColor(INK).text(t(a.title), { width: width() });
    doc.moveDown(0.35);
    doc
      .font(FONT.regular)
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        t(
          TEXT.meta(
            a.reference,
            longDate(a.preparedAt),
            a.proposalReference,
            a.proposalSignature.revision,
          ),
        ),
      )
      .text(t(statusLine(a)));
    rule();
  };
  const drawParties = () => {
    const party = (title: string, p: AgreementParty, x: number, w: number) => {
      label(title, x, doc.y, w);
      doc.moveDown(0.2);
      doc.font(FONT.bold).fontSize(11).fillColor(INK).text(t(p.name), x, doc.y, { width: w });
      doc.font(FONT.regular).fontSize(9).fillColor(INK);
      for (const line of [p.address, p.phone, p.email]) {
        if (line) doc.text(t(line), x, doc.y, { width: w });
      }
    };
    columns((x, w, side) =>
      side === 0 ? party(TEXT.seller, a.seller, x, w) : party(TEXT.buyer, a.buyer, x, w),
    );
    rule();
  };
  const drawClauses = () => {
    a.sections.forEach((s, i) => {
      ensure(HEADING_AND_FIRST_LINES_HEIGHT);
      doc
        .font(FONT.bold)
        .fontSize(11)
        .fillColor(INK)
        .text(t(`${i + 1}. ${s.heading}`), left(), doc.y, { width: width() });
      doc.moveDown(0.35);
      doc.font(FONT.regular).fontSize(10).fillColor(INK);
      for (const paragraph of s.body.split(/\n\s*\n/)) {
        doc.text(t(paragraph.trim()), left(), doc.y, { width: width(), lineGap: 2.5 });
        doc.moveDown(0.55);
      }
      doc.moveDown(0.35);
    });
  };
  const drawSignatures = () => {
    const titleOf = (i: number) =>
      i < a.purchasers.length ? TEXT.purchaser(i + 1, a.purchasers.length) : TEXT.forTheSeller;
    ensure(170);
    doc.moveDown(0.4);
    doc.font(FONT.bold).fontSize(12).fillColor(INK).text(TEXT.signatures, left(), doc.y);
    doc.moveDown(0.6);
    const signatureBlock = (title: string, signer: Signer, x: number, w: number) => {
      label(title, x, doc.y, w);
      doc.moveDown(0.25);
      doc
        .font(FONT.bold)
        .fontSize(10.5)
        .fillColor(INK)
        .text(t(signer.name), x, doc.y, { width: w });
      doc.moveDown(0.4);
      const signed = signer.signature;
      if (signed) {
        doc
          .font(FONT.italic)
          .fontSize(14)
          .fillColor(INK)
          .text(t(signed.fullName), x, doc.y, { width: w });
        doc
          .font(FONT.regular)
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(t(TEXT.signedElectronicallyBy(signed.fullName)), x, doc.y, { width: w })
          .text(TEXT.signedOn(utcStamp(signed.signedAt)), x, doc.y, { width: w });
        if (signed.initials?.length) {
          doc.text(t(TEXT.initialled(signed.initials.join(', '))), x, doc.y, { width: w });
        }
      } else {
        doc.moveDown(1.4);
        doc
          .moveTo(x, doc.y)
          .lineTo(x + w, doc.y)
          .lineWidth(0.6)
          .strokeColor(MUTED)
          .stroke();
        doc.moveDown(0.3);
        doc
          .font(FONT.regular)
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(TEXT.signatureLine, x, doc.y, { width: w });
      }
    };
    for (let i = 0; i < signers.length; i += 2) {
      ensure(120);
      columns((x, w, side) => {
        const signer = signers[i + side];
        if (signer) signatureBlock(titleOf(i + side), signer, x, w);
      });
      doc.moveDown(0.8);
    }
    doc.moveDown(0.4);
    doc
      .font(FONT.regular)
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(TEXT.fingerprintNote, left(), doc.y, { width: width() });
    doc.font(FONT.mono).fontSize(7.5).text(TEXT.fingerprint(a.contentHash), { width: width() });
  };
  const drawHome = () => {
    doc.font(FONT.bold).fontSize(14).fillColor(INK).text(TEXT.scheduleTitle, left(), doc.y);
    doc.moveDown(0.6);
    const place = [a.home.address, a.home.community].filter(Boolean).join(', ');
    doc
      .font(FONT.bold)
      .fontSize(11)
      .text(
        t(
          `${capitalize(theModel(a.home.model))}${a.home.kind === 'inventory' && place ? `, ${place}` : ''}`,
        ),
      );
    const specs = a.home.specs;
    const details = [
      a.home.kind === 'inventory' ? TEXT.inventoryHome : TEXT.builtToOrder,
      specs && TEXT.sqft(specs.sqft.toLocaleString(NUMBER_LOCALE)),
      specs && TEXT.bedrooms(specs.beds),
      specs && TEXT.bathrooms(specs.baths),
      specs?.garage ? TEXT.garage(specs.garage) : undefined,
      specs?.storeys ? TEXT.storeys(specs.storeys) : undefined,
    ].filter(Boolean);
    doc
      .font(FONT.regular)
      .fontSize(9)
      .fillColor(MUTED)
      .text(t(details.join('  ·  ')));
    doc.text(
      t(
        TEXT.acceptedIn(
          a.proposalReference,
          a.proposalSignature.revision,
          a.proposalSignature.fullName,
          utcStamp(a.proposalSignature.signedAt),
        ),
      ),
    );
    rule();
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
  const group = (title: string) => {
    ensure(40);
    doc.moveDown(0.4);
    label(title);
    doc.moveDown(0.3);
  };

  const drawPrice = () => {
    const q = a.quote;
    row(TEXT.basePrice(a.home.model), money(q.baseCents));
    const areas = new Map<string, typeof q.lines>();
    for (const line of q.lines)
      areas.set(line.areaLabel, [...(areas.get(line.areaLabel) ?? []), line]);
    for (const [area, lines] of areas) {
      group(area);
      for (const line of lines) {
        row(
          line.kind === 'package' ? TEXT.packageLine(line.name) : line.name,
          line.unitCents === 0 ? TEXT.included : money(line.unitCents),
        );
      }
    }
    if (q.adjustments.length) {
      group(TEXT.adjustments);
      for (const adj of q.adjustments) row(adj.label, money(adj.amountCents));
    }
    if (q.referral) {
      group(TEXT.referral);
      row(
        TEXT.referralLine(q.referral.programName, q.referral.referrerName),
        money(-q.referral.creditCents),
      );
    }
    rule();
    const pricedBeforeSalesTax = q.subtotalCents === undefined;
    if (pricedBeforeSalesTax) {
      row(TEXT.purchasePrice, money(q.totalCents), { bold: true });
    } else {
      row(TEXT.priceBeforeTax, money(q.subtotalCents!));
      if (q.tax) {
        group(TEXT.salesTax(`${q.tax.regionName} (${q.tax.regionCode})`));
        for (const line of q.tax.lines) {
          row(TEXT.taxLine(line.label, formatPercent(line.ratePercent)), money(line.amountCents));
        }
      } else {
        row(TEXT.noSalesTax, money(0), { muted: true });
      }
      doc.moveDown(0.3);
      row(TEXT.totalWithTax, money(q.totalCents), { bold: true });
    }
  };
  const drawTerms = () => {
    const q = a.quote;
    doc.moveDown(0.3);
    group(TEXT.deposits);
    for (const instalment of a.terms.deposits) {
      row(
        instalment.dueDate
          ? `${instalment.label} (${longDate(instalment.dueDate)})`
          : instalment.label,
        money(instalment.amountCents),
      );
    }
    row(TEXT.deposit, money(a.terms.depositCents), { bold: true });
    doc.moveDown(0.3);
    row(TEXT.balance, money(q.totalCents - a.terms.depositCents));
    row(
      TEXT.closing,
      a.terms.closingDate ? longDate(a.terms.closingDate) : TEXT.closingToBeConfirmed,
    );
    group(TEXT.conditions);
    if (a.terms.conditions.length) {
      for (const condition of a.terms.conditions) {
        row(
          condition.details ? `${condition.label}: ${condition.details}` : condition.label,
          condition.dueDate ? longDate(condition.dueDate) : '',
        );
      }
    } else {
      row(TEXT.noConditions, '', { muted: true });
    }
  };
  const drawCertificate = () => {
    const captured = signers.filter((s) => s.signature);
    if (!captured.length) return;
    doc.addPage();
    doc.font(FONT.bold).fontSize(14).fillColor(INK).text(TEXT.certificateTitle, left(), doc.y);
    doc.moveDown(0.4);
    doc
      .font(FONT.regular)
      .fontSize(9)
      .fillColor(MUTED)
      .text(TEXT.certificateIntro, { width: width() });
    rule();
    const fact = (name: string, value: string, mono = false) => {
      const valueX = left() + 150;
      const valueWidth = width() - 150;
      doc.font(mono ? FONT.mono : FONT.regular).fontSize(9);
      const height = doc.heightOfString(t(value), { width: valueWidth });
      ensure(height + 4);
      const y = doc.y;
      doc.font(FONT.regular).fontSize(9).fillColor(MUTED).text(t(name), left(), y, { width: 145 });
      doc
        .font(mono ? FONT.mono : FONT.regular)
        .fillColor(INK)
        .text(t(value), valueX, y, { width: valueWidth });
      doc.x = left();
      doc.y = y + height + 4;
    };
    fact(TEXT.documentLabel, `${a.title} (${a.reference})`);
    fact(TEXT.documentHash, a.contentHash, true);
    for (const { signature: sig, name, role } of captured as Required<Signer>[]) {
      doc.moveDown(0.5);
      ensure(90);
      doc
        .font(FONT.bold)
        .fontSize(10.5)
        .fillColor(INK)
        .text(t(`${sig.fullName} (${name})`), left(), doc.y, { width: width() });
      doc.moveDown(0.25);
      fact(TEXT.roleColumn, role);
      fact(TEXT.timeColumn, utcStamp(sig.signedAt));
      fact(TEXT.ipColumn, sig.ip ?? TEXT.noIp);
      fact(TEXT.hashColumn, sig.contentHash, true);
      fact(TEXT.providerColumn, sig.provider);
      if (sig.initials?.length) fact(TEXT.signatures, TEXT.initialled(sig.initials.join(', ')));
    }
    if (a.executedAt) {
      rule();
      doc
        .font(FONT.regular)
        .fontSize(9)
        .fillColor(MUTED)
        .text(t(TEXT.certificateFooter(a.reference, utcStamp(a.executedAt))), left(), doc.y, {
          width: width(),
        });
    }
  };
  const decoratePages = () => {
    const pages = doc.bufferedPageRange();
    const mark = watermarkOf(a);
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      writeInBottomMargin(() => {
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
          .text(TEXT.page(i + 1, pages.count), left() + width() - 90, y, {
            width: 90,
            align: 'right',
            lineBreak: false,
          });
      });
    }
  };

  drawLetterhead();
  drawTitle();
  drawParties();
  drawClauses();
  drawSignatures();
  doc.addPage();
  drawHome();
  drawPrice();
  drawTerms();
  drawCertificate();
  decoratePages();

  doc.end();
  return done;
};
