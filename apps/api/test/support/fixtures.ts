import {
  AccessKeyStatus,
  AccessResourceType,
  AgreementStatus,
  ChangeRequestStatus,
  SignerStatus,
  HouseStatus,
  InventoryStatus,
  Party,
  PaymentAction,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  ProposalStatus,
  Role,
  type AgreementPurchaser,
  type AgreementSignature,
  type Catalog,
  type QuoteSnapshot,
} from '@homepact/shared';
import type { AccessKeyDoc } from '../../src/modules/access-keys/keys.js';
import type { AgreementTemplateDoc } from '../../src/modules/agreement-templates/store.js';
import type { AgreementDoc } from '../../src/modules/agreements/store.js';
import type { RefreshTokenDoc } from '../../src/modules/auth/sessions.js';
import type { UserDoc } from '../../src/modules/auth/users.js';
import type { AreaDoc, CatalogItemDoc, PackageDoc } from '../../src/modules/catalog/store.js';
import type { HouseDoc } from '../../src/modules/houses/store.js';
import type { InventoryHomeDoc } from '../../src/modules/inventory/store.js';
import type { PaymentDoc } from '../../src/modules/payments/store.js';
import type { TaxPresetDoc } from '../../src/data/platform-repo.js';
import type { ReferralProgramDoc } from '../../src/modules/referrals/store.js';
import type { TaxRateDoc } from '../../src/modules/sales-tax/store.js';
import type {
  ChangeRequestDoc,
  MessageDoc,
  ProposalDoc,
  RevisionDoc,
} from '../../src/modules/proposals/store.js';
import { COMPANY_ID, NOW_ISO } from './mocks.js';

export const catalog = (): Catalog => ({
  areas: [
    { slug: 'kitchen', label: 'Kitchen', order: 1 },
    { slug: 'flooring', label: 'Flooring', order: 2, description: 'Main floor' },
    { slug: 'empty', label: 'Empty area', order: 3 },
  ],
  items: [
    { id: 'item-island', areaSlug: 'kitchen', name: 'Island', priceCents: 500_000 },
    { id: 'item-hood', areaSlug: 'kitchen', name: 'Range hood', priceCents: 150_000 },
    {
      id: 'item-trim',
      areaSlug: 'kitchen',
      name: 'Trim',
      priceCents: 20_000,
      soldSeparately: false,
    },
    { id: 'item-oak', areaSlug: 'flooring', name: 'Oak', priceCents: 800_000 },
  ],
  packages: [
    {
      id: 'pkg-signature',
      areaSlug: 'kitchen',
      name: 'Signature',
      itemIds: ['item-island', 'item-hood'],
      priceCents: 900_000,
    },
    {
      id: 'pkg-standard',
      areaSlug: 'kitchen',
      name: 'Standard',
      itemIds: ['item-hood'],
      priceCents: 0,
    },
  ],
});

export const houseDoc = (over: Partial<HouseDoc> = {}): HouseDoc => ({
  _id: 'house-1',
  companyId: COMPANY_ID,
  name: 'The Aspen',
  slug: 'aspen',
  style: 'Modern',
  description: 'A bright family home',
  communities: ['Riverside'],
  specs: { sqft: 2000, beds: 3, baths: 2.5, garage: 2 },
  images: ['https://img.test/aspen.jpg'],
  floorPlanImages: [],
  basePriceCents: 50_000_000,
  priceOverrides: [],
  status: HouseStatus.Published,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  ...over,
});

export const quote = (over: Partial<QuoteSnapshot> = {}): QuoteSnapshot => ({
  houseId: 'house-1',
  houseName: 'The Aspen',
  currency: 'CAD',
  baseCents: 50_000_000,
  lines: [],
  adjustments: [],
  totalCents: 50_000_000,
  ...over,
});

export const inventoryDoc = (over: Partial<InventoryHomeDoc> = {}): InventoryHomeDoc => ({
  _id: 'home-1',
  companyId: COMPANY_ID,
  houseId: 'house-1',
  address: '12 Main St',
  community: 'Riverside',
  possession: 'Spring',
  selections: { kitchen: { packageId: 'pkg-signature' } },
  priceCents: 61_000_000,
  features: [],
  images: ['https://img.test/home.jpg'],
  lockedByDefault: true,
  status: InventoryStatus.Available,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  ...over,
});

export const proposalDoc = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({
  _id: 'proposal-1',
  companyId: COMPANY_ID,
  reference: 'P-AAAA-BBBB',
  kind: 'plan',
  houseId: 'house-1',
  houseName: 'The Aspen',
  locked: false,
  buyer: { name: 'Bea Buyer', email: 'bea@buyer.test' },
  buyerUserId: 'buyer-1',
  repId: 'staff-1',
  repName: 'Sam Staff',
  status: ProposalStatus.Proposed,
  currentRevision: 1,
  currentTotalCents: 50_000_000,
  currency: 'CAD',
  accessKeyId: 'key-1',
  lastActivityAt: NOW_ISO,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  ...over,
});

export const revisionDoc = (over: Partial<RevisionDoc> = {}): RevisionDoc => ({
  _id: 'rev-1',
  companyId: COMPANY_ID,
  proposalId: 'proposal-1',
  number: 1,
  selections: { kitchen: { packageId: 'pkg-standard' } },
  quote: quote(),
  authorName: 'Sam Staff',
  createdAt: NOW_ISO,
  ...over,
});

export const changeRequestDoc = (over: Partial<ChangeRequestDoc> = {}): ChangeRequestDoc => ({
  _id: 'cr-1',
  companyId: COMPANY_ID,
  proposalId: 'proposal-1',
  baseRevision: 1,
  changes: [
    {
      id: 'ch-1',
      change: { type: 'set_package', areaSlug: 'kitchen', packageId: 'pkg-signature' },
      label: 'Change Kitchen: Standard → Signature',
      deltaCents: 900_000,
    },
    {
      id: 'ch-2',
      change: { type: 'add_item', areaSlug: 'flooring', itemId: 'item-oak' },
      label: 'Add Oak (Flooring)',
      deltaCents: 800_000,
    },
  ],
  previewTotalCents: 51_700_000,
  status: ChangeRequestStatus.Open,
  authorName: 'Bea Buyer',
  createdAt: NOW_ISO,
  ...over,
});

export const messageDoc = (over: Partial<MessageDoc> = {}): MessageDoc => ({
  _id: 'msg-1',
  companyId: COMPANY_ID,
  proposalId: 'proposal-1',
  party: Party.System,
  authorName: 'System',
  body: 'Hello',
  createdAt: NOW_ISO,
  ...over,
});

export const userDoc = (over: Partial<UserDoc> = {}): UserDoc => ({
  _id: 'buyer-1',
  companyId: COMPANY_ID,
  email: 'bea@buyer.test',
  name: 'Bea Buyer',
  role: Role.Buyer,
  passwordHash: 'scrypt$salt$hash',
  active: true,
  createdAt: NOW_ISO,
  ...over,
});

export const accessKeyDoc = (over: Partial<AccessKeyDoc> = {}): AccessKeyDoc => ({
  _id: 'key-1',
  companyId: COMPANY_ID,
  hash: 'hash-of-key',
  resourceType: AccessResourceType.Proposal,
  resourceId: 'proposal-1',
  status: AccessKeyStatus.Active,
  createdBy: 'staff-1',
  createdAt: NOW_ISO,
  ...over,
});

export const refreshTokenDoc = (over: Partial<RefreshTokenDoc> = {}): RefreshTokenDoc => ({
  _id: 'rt-1',
  companyId: COMPANY_ID,
  hash: 'hash-of-refresh',
  userId: 'buyer-1',
  familyId: 'family-1',
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  revoked: false,
  ...over,
});

export const areaDoc = (over: Partial<AreaDoc> = {}): AreaDoc => ({
  _id: 'area-1',
  companyId: COMPANY_ID,
  slug: 'kitchen',
  label: 'Kitchen',
  order: 1,
  ...over,
});

export const itemDoc = (over: Partial<CatalogItemDoc> = {}): CatalogItemDoc => ({
  _id: 'item-island',
  companyId: COMPANY_ID,
  areaSlug: 'kitchen',
  name: 'Island',
  priceCents: 500_000,
  soldSeparately: true,
  ...over,
});

export const packageDoc = (over: Partial<PackageDoc> = {}): PackageDoc => ({
  _id: 'pkg-signature',
  companyId: COMPANY_ID,
  areaSlug: 'kitchen',
  name: 'Signature',
  itemIds: ['item-island', 'item-hood'],
  priceCents: 900_000,
  ...over,
});

export const PLAIN_KEY = 'plain-access-key-0123456789';

export const templateDoc = (over: Partial<AgreementTemplateDoc> = {}): AgreementTemplateDoc => ({
  _id: 'tpl-1',
  companyId: COMPANY_ID,
  name: 'Standard agreement',
  title: 'Purchase agreement for {{buyer.name}}',
  sections: [
    { heading: 'Price', body: 'The price is {{price.total}}.' },
    {
      heading: 'Deposit',
      body: 'Deposit {{deposit.amount}}; balance {{balance.amount}}.',
      requiresInitials: true,
    },
  ],
  isDefault: true,
  version: 2,
  updatedByName: 'Alex Admin',
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  ...over,
});

export const SIGNATURE = {
  fullName: 'Bea Buyer',
  revision: 1,
  totalCents: 50_000_000,
  signedAt: '2026-10-30T15:45:00.000Z',
};

export const HASH = 'c0ffee'.padEnd(64, '0');

/** The purchasers of the fixture agreement; the second one is a co-purchaser. */
export const purchaserDoc = (over: Partial<AgreementPurchaser> = {}): AgreementPurchaser => ({
  id: 'pur-1',
  name: 'Bea Buyer',
  email: 'bea@buyer.test',
  status: SignerStatus.Pending,
  ...over,
});

export const signature = (over: Partial<AgreementSignature> = {}): AgreementSignature => ({
  fullName: 'Bea Q. Buyer',
  signedAt: NOW_ISO,
  contentHash: HASH,
  ip: '203.0.113.5',
  provider: 'built-in',
  initials: [1],
  ...over,
});

/** A purchaser who has signed the current content. */
export const signedPurchaser = (over: Partial<AgreementPurchaser> = {}): AgreementPurchaser =>
  purchaserDoc({ status: SignerStatus.Signed, signature: signature(), ...over });

export const TERMS = {
  deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
  conditions: [{ label: 'Financing', details: 'A mortgage commitment.', dueDate: '2027-02-01' }],
  depositCents: 2_500_000,
  closingDate: '2027-03-15',
};

export const agreementDoc = (over: Partial<AgreementDoc> = {}): AgreementDoc => ({
  _id: 'agr-1',
  companyId: COMPANY_ID,
  reference: 'A-TEST-0001',
  status: AgreementStatus.Draft,
  proposalId: 'proposal-1',
  proposalReference: 'P-AAAA-BBBB',
  template: { id: 'tpl-1', name: 'Standard agreement', version: 2 },
  title: 'Purchase agreement for Bea Buyer',
  sections: [
    { heading: 'Price', body: 'The price is $500,000.' },
    { heading: 'Deposit', body: 'Deposit $25,000; balance $480,000.', requiresInitials: true },
  ],
  seller: { name: 'Company A', address: '1 Builder Way', phone: '555-0100' },
  buyer: { name: 'Bea Buyer', email: 'bea@buyer.test' },
  purchasers: [purchaserDoc()],
  home: { kind: 'plan', model: 'The Aspen', specs: houseDoc().specs },
  quote: quote(),
  proposalSignature: SIGNATURE,
  terms: TERMS,
  currency: 'CAD',
  repName: 'Sam Staff',
  preparedAt: NOW_ISO,
  contentHash: HASH,
  createdByName: 'Sam Staff',
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  ...over,
});

/** A province the company sells in: Ontario, the company's default. */
export const taxRateDoc = (over: Partial<TaxRateDoc> = {}): TaxRateDoc => ({
  _id: 'tax-on',
  companyId: COMPANY_ID,
  code: 'ON',
  name: 'Ontario',
  components: [{ label: 'HST', ratePercent: 13 }],
  isDefault: true,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  ...over,
});

/** One of the platform's suggestions (not a tenant document: no companyId). */
export const taxPresetDoc = (over: Partial<TaxPresetDoc> = {}): TaxPresetDoc => ({
  _id: 'preset-qc',
  code: 'QC',
  name: 'Quebec',
  components: [
    { label: 'GST', ratePercent: 5 },
    { label: 'QST', ratePercent: 9.975 },
  ],
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  ...over,
});

export const referralProgramDoc = (over: Partial<ReferralProgramDoc> = {}): ReferralProgramDoc => ({
  _id: 'prog-1',
  companyId: COMPANY_ID,
  name: 'Refer a friend',
  description: 'The referrer gets a $1,000 thank-you on closing.',
  creditCents: 200_000,
  active: true,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  ...over,
});

/** A $10,000 cheque toward the deposit of `agreementDoc()`, posted by finance. */
export const paymentDoc = (over: Partial<PaymentDoc> = {}): PaymentDoc => ({
  _id: 'pay-1',
  companyId: COMPANY_ID,
  reference: 'PAY-AAAA-0001',
  agreementId: 'agr-1',
  agreementReference: 'A-TEST-0001',
  kind: PaymentKind.Payment,
  status: PaymentStatus.Posted,
  amountCents: 1_000_000,
  currency: 'CAD',
  receivedOn: '2026-10-30',
  method: PaymentMethod.Cheque,
  externalRef: '#101',
  recordedBy: { id: 'finance-1', name: 'Fran Finance', role: Role.CompanyFinance },
  recordedAt: NOW_ISO,
  history: [
    {
      at: NOW_ISO,
      by: { id: 'finance-1', name: 'Fran Finance', role: Role.CompanyFinance },
      action: PaymentAction.Recorded,
    },
  ],
  updatedAt: NOW_ISO,
  ...over,
});
