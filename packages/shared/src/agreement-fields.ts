import { AgreementStatus } from './enums.js';

export const AGREEMENT_FIELDS = [
  { key: 'agreement.reference', label: 'Agreement number' },
  { key: 'agreement.date', label: 'Date the agreement was prepared' },
  { key: 'seller.name', label: 'Your company name' },
  { key: 'seller.address', label: 'Your company address' },
  { key: 'seller.phone', label: 'Your company phone' },
  { key: 'seller.email', label: 'Your company email' },
  { key: 'buyer.name', label: 'Purchaser names (all of them)' },
  { key: 'buyer.email', label: 'Purchaser email (first purchaser)' },
  { key: 'buyer.phone', label: 'Purchaser phone (first purchaser)' },
  { key: 'purchasers.list', label: 'Purchasers, one per line' },
  { key: 'home.model', label: 'Floor plan name' },
  { key: 'home.address', label: 'Civic address (pre-existing homes)' },
  { key: 'home.community', label: 'Community' },
  { key: 'home.description', label: 'One-line description of the home' },
  { key: 'proposal.reference', label: 'Signed proposal number' },
  { key: 'proposal.revision', label: 'Revision the buyer signed' },
  { key: 'proposal.signedBy', label: 'Name the buyer signed the proposal with' },
  { key: 'proposal.signedOn', label: 'Date the proposal was signed' },
  { key: 'price.base', label: 'Base price of the plan' },
  { key: 'price.options', label: 'Total of packages and options' },
  { key: 'price.adjustments', label: 'Total of price adjustments' },
  { key: 'price.beforeTax', label: 'Purchase price before tax' },
  { key: 'price.tax', label: 'Sales tax' },
  { key: 'price.taxDetails', label: 'Sales tax rates and province, e.g. "HST 13%, Ontario"' },
  { key: 'price.total', label: 'Purchase price, sales tax included' },
  { key: 'referral.program', label: 'Referral program' },
  { key: 'referral.referrer', label: 'Who referred the buyer' },
  { key: 'referral.credit', label: 'Referral credit to the buyer' },
  { key: 'referral.summary', label: 'The referral and its credit, in one sentence' },
  { key: 'deposit.amount', label: 'Deposit (total of the schedule)' },
  { key: 'deposit.schedule', label: 'Deposit schedule, one instalment per line' },
  { key: 'balance.amount', label: 'Balance due on closing' },
  { key: 'conditions.list', label: 'Conditions, one per line' },
  { key: 'closing.date', label: 'Closing and possession date' },
  { key: 'special.terms', label: 'Special terms of this agreement' },
  { key: 'rep.name', label: 'Sales representative' },
] as const;

export type AgreementFieldKey = (typeof AGREEMENT_FIELDS)[number]['key'];
export type AgreementFieldValues = Record<AgreementFieldKey, string>;

const KNOWN = new Set<string>(AGREEMENT_FIELDS.map((f) => f.key));
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Placeholders in `text` that are not merge fields, in order of appearance, without repeats. */
export const unknownFields = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).filter((k) => !KNOWN.has(k))),
];

/** Replaces every `{{field}}` with its value. Unknown placeholders are left as they are. */
export const fillTemplate = (text: string, values: AgreementFieldValues): string =>
  text.replace(PLACEHOLDER, (whole, key: string) =>
    KNOWN.has(key) ? values[key as AgreementFieldKey] : whole,
  );

export const CONDITION_PRESETS: readonly { label: string; details: string }[] = [
  {
    label: 'Financing',
    details:
      'The Buyer obtaining a written mortgage commitment for the purchase price on terms acceptable to the Buyer.',
  },
  {
    label: 'Home inspection',
    details:
      'The Buyer obtaining an inspection report on the home that is satisfactory to the Buyer.',
  },
  {
    label: 'Sale of the Buyer’s home',
    details: 'The Buyer completing the sale of their current home.',
  },
  {
    label: 'Lawyer’s review',
    details: 'Review and approval of this agreement by the Buyer’s lawyer.',
  },
];

export interface AgreementSectionText {
  heading: string;
  body: string;
  requiresInitials?: boolean;
}

/** Clause numbers (1-based, as the document reads) every purchaser must initial to sign. */
export const keyClauses = (sections: { requiresInitials?: boolean }[]): number[] =>
  sections.flatMap((s, i) => (s.requiresInitials ? [i + 1] : []));

const FILE_SUFFIX: Record<AgreementStatus, string> = {
  [AgreementStatus.Draft]: 'draft',
  [AgreementStatus.UnderReview]: 'for-signature',
  [AgreementStatus.Signed]: 'signed',
  [AgreementStatus.Executed]: 'executed',
  [AgreementStatus.Cancelled]: 'void',
};

export const agreementFileName = (reference: string, status: AgreementStatus): string =>
  `${reference}-${FILE_SUFFIX[status]}.pdf`;

export const receiptFileName = (paymentReference: string): string =>
  `${paymentReference}-receipt.pdf`;

export const STARTER_AGREEMENT_TEMPLATE: {
  name: string;
  title: string;
  sections: AgreementSectionText[];
} = {
  name: 'New home purchase agreement',
  title: 'Agreement of purchase and sale: new home',
  sections: [
    {
      heading: 'Parties',
      body: 'This agreement is made on {{agreement.date}} between {{seller.name}} (the "Seller") and the following purchasers, together the "Buyer":\n\n{{purchasers.list}}',
    },
    {
      heading: 'The home',
      body: 'The Seller agrees to sell, and the Buyer agrees to buy, {{home.description}}.\n\nThe home is configured exactly as set out in Schedule A, which reproduces revision {{proposal.revision}} of proposal {{proposal.reference}}, accepted by the Buyer as {{proposal.signedBy}} on {{proposal.signedOn}}.',
    },
    {
      heading: 'Purchase price and deposit',
      body: 'The purchase price is {{price.total}}, sales tax included: {{price.beforeTax}} before tax, plus {{price.tax}} of sales tax ({{price.taxDetails}}). It includes the packages, options, adjustments and credits listed in Schedule A.\n\n{{referral.summary}}\n\nThe Buyer will pay a deposit of {{deposit.amount}} in these instalments:\n\n{{deposit.schedule}}\n\nThe balance of {{balance.amount}} is due on closing.',
      requiresInitials: true,
    },
    {
      heading: 'Closing and possession',
      body: 'Closing and possession are scheduled for {{closing.date}}. The Seller will give the Buyer written notice of any change to this date.',
    },
    {
      heading: 'Conditions',
      body: 'This agreement is subject to the following conditions:\n\n{{conditions.list}}',
      requiresInitials: true,
    },
    {
      heading: 'Changes after signing',
      body: 'Any change to the configuration of the home after this agreement is signed must be agreed in writing by both parties, and may change the purchase price. A change to the purchase price voids this agreement and returns the proposal to negotiation.',
      requiresInitials: true,
    },
    {
      heading: 'Special terms',
      body: '{{special.terms}}',
    },
    {
      heading: 'Entire agreement',
      body: 'This agreement and Schedule A are the entire agreement between the parties about the purchase of the home. Electronic signatures have the same effect as handwritten ones.',
    },
  ],
};
