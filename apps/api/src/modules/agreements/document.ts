import {
  fillTemplate,
  formatMoney,
  formatPercent,
  priceBeforeTax,
  salesTaxOf,
  type Agreement,
  type AgreementFieldValues,
  type AgreementTermsInput,
  type AgreementTerms,
  type Signature,
} from '@homepact/shared';
import type { CompanyDoc } from '../../data/platform-repo.js';
import { sha256 } from '../../data/ids.js';
import type { AgreementTemplateDoc } from '../agreement-templates/store.js';
import type { HouseDoc } from '../houses/store.js';
import type { ProposalDoc, RevisionDoc } from '../proposals/store.js';
import { AGREEMENT_TEXT } from '../../messages.js';
import { identityOf, type PurchaserIdentity } from './purchasers.js';

export type AgreementContent = Pick<
  Agreement,
  | 'reference'
  | 'proposalId'
  | 'proposalReference'
  | 'template'
  | 'title'
  | 'sections'
  | 'seller'
  | 'buyer'
  | 'home'
  | 'quote'
  | 'proposalSignature'
  | 'terms'
  | 'currency'
  | 'repName'
  | 'preparedAt'
> & { purchasers: PurchaserIdentity[] };

export interface AgreementSources {
  reference: string;
  preparedAt: Date;
  company: Pick<CompanyDoc, 'name' | 'contact'>;
  proposal: ProposalDoc & { signature: Signature };
  revision: RevisionDoc;
  house: HouseDoc | null;
  template: AgreementTemplateDoc;
  purchasers: PurchaserIdentity[];
  terms: AgreementTermsInput;
}

const NONE = AGREEMENT_TEXT.none;

/** "November 4, 2026": calendar dates (or UTC instants), never shifted by the server zone. */
export const longDate = (isoDateOrInstant: string): string =>
  new Intl.DateTimeFormat('en-CA', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(isoDateOrInstant)
        ? `${isoDateOrInstant}T00:00:00Z`
        : isoDateOrInstant,
    ),
  );

/** "2026-11-04 16:20 UTC": unambiguous signing times for the record. */
export const utcStamp = (iso: string): string =>
  `${iso.slice(0, 16).replace('T', ' ')} ${AGREEMENT_TEXT.utc}`;

/** "the Alder", but "The Aspen" when the plan's name already has its article. */
export const theModel = (model: string): string => {
  const article = AGREEMENT_TEXT.article;
  return model.toLowerCase().startsWith(`${article.toLowerCase()} `)
    ? model
    : `${article} ${model}`;
};

/** Joins names the way a contract reads them: "A", "A and B", "A, B and C". */
export const nameList = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} ${AGREEMENT_TEXT.and} ${names.at(-1)}`;

/** Cleans up the terms and totals the deposit from its instalments. */
export const normalizeTerms = (terms: AgreementTermsInput): AgreementTerms => ({
  deposits: terms.deposits.map((d) => ({
    label: d.label,
    amountCents: d.amountCents,
    ...(d.dueDate && { dueDate: d.dueDate }),
  })),
  depositCents: terms.deposits.reduce((total, d) => total + d.amountCents, 0),
  conditions: terms.conditions.map((c) => ({
    label: c.label,
    ...(c.details?.trim() && { details: c.details.trim() }),
    ...(c.dueDate && { dueDate: c.dueDate }),
  })),
  ...(terms.closingDate && { closingDate: terms.closingDate }),
  ...(terms.specialTerms?.trim() && { specialTerms: terms.specialTerms.trim() }),
});

/** Everything but the rendered text: who, what, for how much, on what terms. */
const facts = (src: AgreementSources): Omit<AgreementContent, 'title' | 'sections'> => {
  const { proposal: p, revision, company, house } = src;
  const contact = company.contact ?? {};
  const first = src.purchasers[0];
  return {
    reference: src.reference,
    proposalId: p._id,
    proposalReference: p.reference,
    template: { id: src.template._id, name: src.template.name, version: src.template.version },
    seller: {
      name: company.name,
      ...(contact.address && { address: contact.address }),
      ...(contact.phone && { phone: contact.phone }),
      ...(contact.email && { email: contact.email }),
    },
    purchasers: src.purchasers,
    buyer: {
      name: nameList(src.purchasers.map((b) => b.name)),
      ...(first?.email && { email: first.email }),
      ...(first?.phone && { phone: first.phone }),
      ...(first?.address && { address: first.address }),
    },
    home: {
      kind: p.kind,
      model: p.houseName,
      ...(p.address && { address: p.address }),
      ...(p.community && { community: p.community }),
      ...(house && { specs: house.specs }),
    },
    quote: revision.quote,
    proposalSignature: p.signature,
    terms: normalizeTerms(src.terms),
    currency: revision.quote.currency,
    ...(p.repName && { repName: p.repName }),
    preparedAt: src.preparedAt.toISOString(),
  };
};

export const fieldValues = (
  f: Omit<AgreementContent, 'title' | 'sections'>,
): AgreementFieldValues => {
  const money = (cents: number) => formatMoney(cents, f.currency);
  const { quote, home, terms } = f;
  const place = [home.address, home.community].filter(Boolean).join(', ');
  const bullet = (lines: string[], empty: string) =>
    lines.length ? lines.map((l) => `- ${l}`).join('\n') : empty;
  return {
    'agreement.reference': f.reference,
    'agreement.date': longDate(f.preparedAt),
    'seller.name': f.seller.name,
    'seller.address': f.seller.address ?? NONE,
    'seller.phone': f.seller.phone ?? NONE,
    'seller.email': f.seller.email ?? NONE,
    'buyer.name': f.buyer.name,
    'buyer.email': f.buyer.email ?? NONE,
    'buyer.phone': f.buyer.phone ?? NONE,
    'home.model': home.model,
    'home.address': home.address ?? AGREEMENT_TEXT.lotToBeAssigned,
    'home.community': home.community || NONE,
    'home.description':
      home.kind === 'inventory' && place
        ? AGREEMENT_TEXT.homeAt(theModel(home.model), place)
        : AGREEMENT_TEXT.homeBuiltToOrder(theModel(home.model)),
    'proposal.reference': f.proposalReference,
    'proposal.revision': String(f.proposalSignature.revision),
    'proposal.signedBy': f.proposalSignature.fullName,
    'proposal.signedOn': longDate(f.proposalSignature.signedAt),
    'price.base': money(quote.baseCents),
    'price.options': money(quote.lines.reduce((t, l) => t + l.unitCents, 0)),
    'price.adjustments': money(quote.adjustments.reduce((t, a) => t + a.amountCents, 0)),
    'price.beforeTax': money(priceBeforeTax(quote)),
    'price.tax': money(salesTaxOf(quote)),
    'price.taxDetails': quote.tax
      ? AGREEMENT_TEXT.taxDetails(
          quote.tax.lines.map((l) => AGREEMENT_TEXT.taxRate(l.label, formatPercent(l.ratePercent))),
          quote.tax.regionName,
        )
      : AGREEMENT_TEXT.noSalesTax,
    'price.total': money(quote.totalCents),
    'referral.program': quote.referral?.programName ?? NONE,
    'referral.referrer': quote.referral?.referrerName ?? NONE,
    'referral.credit': quote.referral ? money(quote.referral.creditCents) : NONE,
    'referral.summary': quote.referral
      ? AGREEMENT_TEXT.referralSummary(
          quote.referral.referrerName,
          quote.referral.programName,
          quote.referral.creditCents ? money(quote.referral.creditCents) : null,
        )
      : AGREEMENT_TEXT.noReferral,
    'purchasers.list': bullet(
      f.purchasers.map((b) =>
        [b.name, b.email, b.phone, b.address].filter(Boolean).join(AGREEMENT_TEXT.separator),
      ),
      NONE,
    ),
    'deposit.amount': money(terms.depositCents),
    'deposit.schedule': bullet(
      terms.deposits.map((d) =>
        AGREEMENT_TEXT.instalment(money(d.amountCents), d.label, d.dueDate && longDate(d.dueDate)),
      ),
      NONE,
    ),
    'balance.amount': money(quote.totalCents - terms.depositCents),
    'conditions.list': bullet(
      terms.conditions.map((c) =>
        AGREEMENT_TEXT.condition(c.label, c.details, c.dueDate && longDate(c.dueDate)),
      ),
      AGREEMENT_TEXT.noConditions,
    ),
    'closing.date': terms.closingDate
      ? longDate(terms.closingDate)
      : AGREEMENT_TEXT.closingToBeConfirmed,
    'special.terms': terms.specialTerms ?? AGREEMENT_TEXT.noSpecialTerms,
    'rep.name': f.repName ?? NONE,
  };
};

/** Fills the template with the proposal, company and terms: the agreement both parties sign. */
export const composeAgreement = (
  src: AgreementSources,
): AgreementContent & { contentHash: string } => {
  const base = facts(src);
  const values = fieldValues(base);
  const content: AgreementContent = {
    ...base,
    title: fillTemplate(src.template.title, values),
    sections: src.template.sections.map((s) => ({
      heading: fillTemplate(s.heading, values),
      body: fillTemplate(s.body, values),
      ...(s.requiresInitials && { requiresInitials: true }),
    })),
  };
  return { ...content, contentHash: contentHash(content) };
};

/** JSON with sorted keys and no undefined values: the same content always hashes the same. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const CONTENT_KEYS = [
  'reference',
  'purchasers',
  'proposalId',
  'proposalReference',
  'template',
  'title',
  'sections',
  'seller',
  'buyer',
  'home',
  'quote',
  'proposalSignature',
  'terms',
  'currency',
  'repName',
  'preparedAt',
] as const satisfies readonly (keyof AgreementContent)[];

/** SHA-256 of the signed content only: not its status, and not who has signed it so far. */
export const contentHash = (agreement: AgreementContent): string =>
  sha256(
    canonicalJson({
      ...Object.fromEntries(CONTENT_KEYS.map((k) => [k, agreement[k]])),
      purchasers: agreement.purchasers.map(identityOf),
    }),
  );
