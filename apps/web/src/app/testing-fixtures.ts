import {
  AgreementStatus,
  HouseStatus,
  Party,
  ProposalStatus,
  SignerStatus,
} from '@homepact/shared/enums';
import type {
  Agreement,
  AgreementPurchaser,
  AgreementTemplate,
  HouseDetail,
  ProposalDetail,
  QuoteSnapshot,
  Selections,
  TaxRate,
} from '@homepact/shared';

export const HOUSE_DETAIL: HouseDetail = {
  house: {
    id: 'h1',
    name: 'Alder',
    slug: 'alder',
    style: 'Front garage',
    communities: [],
    specs: { sqft: 2220, beds: 3, baths: 2.5 },
    images: [],
    floorPlanImages: [],
    basePriceCents: 60_000_000,
    status: HouseStatus.Published,
    createdAt: '',
    updatedAt: '',
  } as unknown as HouseDetail['house'],
  currency: 'CAD',
  areas: [
    {
      slug: 'kitchen',
      label: 'Kitchen',
      packages: [
        {
          id: 'chef',
          name: 'Chef',
          priceCents: 650_000,
          itemIds: ['quartz', 'island'],
          itemNames: ['Quartz', 'Island'],
        },
      ],
      items: [
        { id: 'quartz', name: 'Quartz', priceCents: 500_000, soldSeparately: true },
        { id: 'island', name: 'Island', priceCents: 300_000, soldSeparately: true },
      ],
    },
    {
      slug: 'exterior',
      label: 'Exterior',
      packages: [],
      items: [{ id: 'stone', name: 'Stone', priceCents: 900_000, soldSeparately: true }],
    },
  ],
};

export const quote = (totalCents: number): QuoteSnapshot => ({
  houseId: 'h1',
  houseName: 'Alder',
  currency: 'CAD',
  baseCents: 60_000_000,
  lines: [],
  adjustments: [],
  totalCents,
});

/** A quote priced in Alberta: $606,500 less a $1,000 credit, plus 5% GST. */
export const taxedQuote = (overrides: Partial<QuoteSnapshot> = {}): QuoteSnapshot => ({
  ...quote(62_947_500),
  subtotalCents: 59_950_000,
  tax: {
    regionCode: 'AB',
    regionName: 'Alberta',
    lines: [{ label: 'GST', ratePercent: 5, amountCents: 2_997_500 }],
    totalCents: 2_997_500,
  },
  ...overrides,
});

export const TAX_RATES: TaxRate[] = [
  {
    id: 'tax-ab',
    code: 'AB',
    name: 'Alberta',
    components: [{ label: 'GST', ratePercent: 5 }],
    isDefault: true,
    presetId: 'preset-ab',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'tax-on',
    code: 'ON',
    name: 'Ontario',
    components: [{ label: 'HST', ratePercent: 13 }],
    isDefault: false,
    createdAt: '',
    updatedAt: '',
  },
];

export const proposalDetail = (
  overrides: Partial<ProposalDetail['proposal']> = {},
  extra: Partial<ProposalDetail> = {},
  selections: Selections = { kitchen: { packageId: 'chef' } },
): ProposalDetail => ({
  viewerParty: Party.Buyer,
  proposal: {
    id: 'p1',
    reference: 'P-1001',
    kind: 'plan',
    houseId: 'h1',
    houseName: 'Alder',
    locked: false,
    buyer: { name: 'Robin Buyer' },
    repName: 'Jordan Blake',
    status: ProposalStatus.Proposed,
    currentRevision: 1,
    currentTotalCents: 60_650_000,
    currency: 'CAD',
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  },
  revisions: [
    {
      id: 'r1',
      proposalId: 'p1',
      number: 1,
      selections,
      quote: quote(60_650_000),
      authorName: 'Jordan Blake',
      createdAt: new Date().toISOString(),
    },
  ],
  changeRequests: [],
  messages: [],
  ...extra,
});

/** Waits past the live-pricing debounce. */
export const pause = (ms = 260) => new Promise((r) => setTimeout(r, ms));

export const HASH = 'a'.repeat(64);

/** One purchaser of the agreement below; `signed()` is the same person after signing. */
export const purchaser = (overrides: Partial<AgreementPurchaser> = {}): AgreementPurchaser => ({
  id: 'pur-1',
  name: 'Robin Buyer',
  email: 'robin@example.com',
  status: SignerStatus.Pending,
  ...overrides,
});

export const signedPurchaser = (overrides: Partial<AgreementPurchaser> = {}): AgreementPurchaser =>
  purchaser({
    status: SignerStatus.Signed,
    signature: {
      fullName: 'Robin Buyer',
      signedAt: '2026-11-02T10:00:00.000Z',
      contentHash: HASH,
      provider: 'built-in',
      initials: [2],
    },
    ...overrides,
  });

/** A purchase agreement made from the signed revision of `proposalDetail()`. */
export const agreement = (overrides: Partial<Agreement> = {}): Agreement => ({
  id: 'a1',
  reference: 'A-2001',
  status: AgreementStatus.Draft,
  proposalId: 'p1',
  proposalReference: 'P-1001',
  template: { id: 't1', name: 'Standard', version: 2 },
  title: 'Agreement of purchase and sale',
  sections: [
    { heading: 'Parties', body: 'Between Example Homes and Robin Buyer.' },
    {
      heading: 'Price',
      body: 'The purchase price is $606,500.\n\nA deposit is due on signing.',
      requiresInitials: true,
    },
  ],
  seller: { name: 'Example Homes', phone: '403-555-0100' },
  buyer: { name: 'Robin Buyer', email: 'robin@example.com' },
  purchasers: [purchaser()],
  home: { kind: 'plan', model: 'Alder' },
  quote: quote(60_650_000),
  proposalSignature: {
    fullName: 'Robin Buyer',
    revision: 1,
    totalCents: 60_650_000,
    signedAt: '2026-10-30T15:00:00.000Z',
  },
  terms: {
    deposits: [{ label: 'on signing', amountCents: 3_000_000 }],
    depositCents: 3_000_000,
    conditions: [{ label: 'Financing', details: 'A mortgage commitment.' }],
    closingDate: '2027-03-15',
  },
  currency: 'CAD',
  repName: 'Jordan Blake',
  preparedAt: '2026-11-01T12:00:00.000Z',
  contentHash: HASH,
  createdByName: 'Jordan Blake',
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  ...overrides,
});

export const TEMPLATES: AgreementTemplate[] = [
  {
    id: 't1',
    name: 'Quick possession',
    title: 'Quick possession agreement',
    sections: [{ heading: 'Price', body: '{{price.total}}' }],
    isDefault: false,
    version: 1,
    updatedByName: 'Morgan Reyes',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 't2',
    name: 'Standard',
    title: 'Agreement of purchase and sale',
    sections: [{ heading: 'Price', body: '{{price.total}}' }],
    isDefault: true,
    version: 3,
    updatedByName: 'Morgan Reyes',
    createdAt: '',
    updatedAt: '',
  },
];
