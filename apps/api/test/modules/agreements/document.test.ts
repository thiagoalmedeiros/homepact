import {
  AGREEMENT_FIELDS,
  AgreementStatus,
  ProposalStatus,
  SignerStatus,
  type AgreementTermsInput,
} from '@homepact/shared';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  composeAgreement,
  contentHash,
  fieldValues,
  longDate,
  nameList,
  normalizeTerms,
  theModel,
  utcStamp,
  type AgreementSources,
} from '../../../src/modules/agreements/document.js';
import {
  SIGNATURE,
  houseDoc,
  proposalDoc,
  quote,
  revisionDoc,
  templateDoc,
} from '../../support/fixtures.js';
import { NOW, NOW_ISO } from '../../support/mocks.js';

const signedQuote = quote({
  baseCents: 50_000_000,
  lines: [
    {
      areaSlug: 'kitchen',
      areaLabel: 'Kitchen',
      kind: 'package',
      refId: 'pkg-signature',
      name: 'Signature',
      unitCents: 900_000,
    },
  ],
  adjustments: [{ label: 'Promo', amountCents: -400_000 }],
  totalCents: 50_500_000,
});

const sources = (over: Partial<AgreementSources> = {}): AgreementSources => ({
  reference: 'A-TEST-0001',
  preparedAt: NOW,
  company: {
    name: 'Company A',
    contact: { address: '1 Builder Way', phone: '555-0100', email: 'sales@a.test' },
  },
  proposal: { ...proposalDoc({ status: ProposalStatus.Signed }), signature: SIGNATURE },
  revision: revisionDoc({ quote: signedQuote }),
  house: houseDoc(),
  template: templateDoc(),
  purchasers: [{ id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' }],
  terms: {
    deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
    conditions: [],
    closingDate: '2027-03-15',
    specialTerms: '  ',
  },
  ...over,
});

const terms = (over: Partial<AgreementTermsInput> = {}): AgreementTermsInput => ({
  deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
  conditions: [],
  ...over,
});

describe('dates', () => {
  it('calendar dates and instants read the same wherever the server runs', () => {
    expect(longDate('2027-03-15')).toBe('March 15, 2027');
    expect(longDate('2026-12-31T23:30:00.000Z')).toBe('December 31, 2026');
    expect(utcStamp('2026-10-30T15:45:12.345Z')).toBe('2026-10-30 15:45 UTC');
  });
});

describe('theModel', () => {
  it('names a plan with its article once', () => {
    expect(theModel('Alder')).toBe('the Alder');
    expect(theModel('The Aspen')).toBe('The Aspen');
    expect(theModel('Theodore')).toBe('the Theodore');
  });
});

describe('nameList', () => {
  it('reads the way a contract does', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['Bea'])).toBe('Bea');
    expect(nameList(['Bea', 'Ben'])).toBe('Bea and Ben');
    expect(nameList(['Bea', 'Ben', 'Cam'])).toBe('Bea, Ben and Cam');
  });
});

describe('normalizeTerms', () => {
  it('totals the deposit schedule instead of trusting a typed amount', () => {
    expect(
      normalizeTerms(
        terms({
          deposits: [
            { label: 'on signing', amountCents: 1_000_000 },
            { label: 'on the 30th day', amountCents: 500_000, dueDate: '2027-01-30' },
          ],
        }),
      ),
    ).toEqual({
      deposits: [
        { label: 'on signing', amountCents: 1_000_000 },
        { label: 'on the 30th day', amountCents: 500_000, dueDate: '2027-01-30' },
      ],
      depositCents: 1_500_000,
      conditions: [],
    });
  });

  it('drops blank special terms, blank condition details and missing dates', () => {
    expect(normalizeTerms(terms({ specialTerms: '   ' }))).toEqual({
      deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
      depositCents: 2_500_000,
      conditions: [],
    });
    expect(
      normalizeTerms(
        terms({
          conditions: [{ label: 'Financing', details: ' ', dueDate: '2027-02-01' }],
          closingDate: '2027-01-02',
          specialTerms: ' x ',
        }),
      ),
    ).toEqual({
      deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
      depositCents: 2_500_000,
      conditions: [{ label: 'Financing', dueDate: '2027-02-01' }],
      closingDate: '2027-01-02',
      specialTerms: 'x',
    });
  });
});

describe('composeAgreement', () => {
  it('fills the template with the signed proposal, the company and the terms', () => {
    const a = composeAgreement(sources());
    expect(a).toMatchObject({
      reference: 'A-TEST-0001',
      proposalId: 'proposal-1',
      proposalReference: 'P-AAAA-BBBB',
      template: { id: 'tpl-1', name: 'Standard agreement', version: 2 },
      title: 'Purchase agreement for Bea Buyer',
      sections: [
        { heading: 'Price', body: 'The price is $505,000.' },
        { heading: 'Deposit', body: 'Deposit $25,000; balance $480,000.' },
      ],
      seller: {
        name: 'Company A',
        address: '1 Builder Way',
        phone: '555-0100',
        email: 'sales@a.test',
      },
      buyer: { name: 'Bea Buyer', email: 'bea@buyer.test' },
      purchasers: [{ id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' }],
      home: { kind: 'plan', model: 'The Aspen', specs: houseDoc().specs },
      quote: signedQuote,
      proposalSignature: SIGNATURE,
      terms: {
        deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
        depositCents: 2_500_000,
        conditions: [],
        closingDate: '2027-03-15',
      },
      currency: 'CAD',
      repName: 'Sam Staff',
      preparedAt: NOW_ISO,
    });
    expect(a.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('co-purchasers sign as one party, with the first one’s contact details', () => {
    const a = composeAgreement(
      sources({
        purchasers: [
          { id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test', phone: '555-1' },
          { id: 'pur-2', name: 'Ben Buyer', email: 'ben@buyer.test' },
        ],
      }),
    );
    expect(a.buyer).toEqual({
      name: 'Bea Buyer and Ben Buyer',
      email: 'bea@buyer.test',
      phone: '555-1',
    });
    expect(a.title).toBe('Purchase agreement for Bea Buyer and Ben Buyer');
  });

  it('key clauses keep their initials flag', () => {
    expect(composeAgreement(sources()).sections).toEqual([
      { heading: 'Price', body: 'The price is $505,000.' },
      { heading: 'Deposit', body: 'Deposit $25,000; balance $480,000.', requiresInitials: true },
    ]);
  });

  it('a deleted floor plan only loses the specs', () => {
    expect(composeAgreement(sources({ house: null })).home).toEqual({
      kind: 'plan',
      model: 'The Aspen',
    });
  });
});

describe('fieldValues', () => {
  const values = (over: Partial<AgreementSources> = {}) => {
    const { title: _t, sections: _s, contentHash: _h, ...facts } = composeAgreement(sources(over));
    return fieldValues(facts);
  };

  it('has a value for every merge field', () => {
    const v = values();
    for (const { key } of AGREEMENT_FIELDS) expect(typeof v[key], key).toBe('string');
    expect(v).toMatchObject({
      'agreement.date': 'October 31, 2026',
      'price.base': '$500,000',
      'price.options': '$9,000',
      'price.adjustments': '-$4,000',
      'price.total': '$505,000',
      'deposit.amount': '$25,000',
      'deposit.schedule': '- $25,000 on signing',
      'purchasers.list': '- Bea Buyer, bea@buyer.test',
      'conditions.list': 'None. This agreement is firm.',
      'balance.amount': '$480,000',
      'closing.date': 'March 15, 2027',
      'proposal.revision': '1',
      'proposal.signedBy': 'Bea Buyer',
      'proposal.signedOn': 'October 30, 2026',
      'home.description': 'a new home built to order on The Aspen floor plan',
      'home.address': 'Lot to be assigned',
      'special.terms': 'None.',
      'rep.name': 'Sam Staff',
    });
  });

  it('without sales tax or a referral, the price reads as untaxed and no credit applies', () => {
    expect(values()).toMatchObject({
      'price.beforeTax': '$505,000',
      'price.tax': '$0',
      'price.taxDetails': 'no sales tax applies',
      'referral.program': '—',
      'referral.referrer': '—',
      'referral.credit': '—',
      'referral.summary': 'No referral credit applies.',
    });
  });

  it('spells out the sales tax of the province and the referral credit', () => {
    const taxed = quote({
      ...signedQuote,
      referral: {
        programId: 'prog-1',
        programName: 'Refer a friend',
        referrerName: 'Jo Homeowner',
        creditCents: 200_000,
      },
      subtotalCents: 50_300_000,
      tax: {
        regionCode: 'QC',
        regionName: 'Quebec',
        lines: [
          { label: 'GST', ratePercent: 5, amountCents: 2_515_000 },
          { label: 'QST', ratePercent: 9.975, amountCents: 5_017_425 },
        ],
        totalCents: 7_532_425,
      },
      totalCents: 57_832_425,
    });
    const v = values({ revision: revisionDoc({ quote: taxed }) });
    expect(v).toMatchObject({
      'price.beforeTax': '$503,000',
      'price.tax': '$75,324.25',
      'price.taxDetails': 'GST 5% and QST 9.975%, Quebec',
      'price.total': '$578,324.25',
      'balance.amount': '$553,324.25',
      'referral.program': 'Refer a friend',
      'referral.referrer': 'Jo Homeowner',
      'referral.credit': '$2,000',
      'referral.summary':
        'The Buyer was referred by Jo Homeowner under the Refer a friend program and receives a credit of $2,000, included in the purchase price.',
    });
    const noCredit = values({
      revision: revisionDoc({
        quote: { ...taxed, referral: { ...taxed.referral!, creditCents: 0 } },
      }),
    });
    expect(noCredit['referral.summary']).toBe(
      'The Buyer was referred by Jo Homeowner under the Refer a friend program.',
    );
  });

  it('describes a pre-existing home by its address, and fills gaps sensibly', () => {
    const v = values({
      company: { name: 'Company A' },
      proposal: {
        ...proposalDoc({
          kind: 'inventory',
          address: '12 Main St',
          community: 'Riverside',
          buyer: { name: 'Bea Buyer' },
        }),
        repName: undefined,
        signature: SIGNATURE,
      } as AgreementSources['proposal'],
      terms: terms({
        deposits: [
          { label: 'on signing', amountCents: 1_000_000 },
          { label: 'on closing', amountCents: 500_000, dueDate: '2027-05-01' },
        ],
        conditions: [
          { label: 'Financing', details: 'A mortgage commitment.', dueDate: '2027-02-01' },
          { label: 'Home inspection' },
        ],
        specialTerms: 'Deck by May.',
      }),
    });
    expect(v).toMatchObject({
      'deposit.amount': '$15,000',
      'deposit.schedule': '- $10,000 on signing\n- $5,000 on closing (due May 1, 2027)',
      'conditions.list':
        '- Financing: A mortgage commitment. (by February 1, 2027)\n- Home inspection',
      'home.description': 'The Aspen home at 12 Main St, Riverside',
      'home.address': '12 Main St',
      'home.community': 'Riverside',
      'seller.address': '—',
      'seller.email': '—',
      'buyer.phone': '—',
      'closing.date': 'a date the Seller will confirm in writing',
      'special.terms': 'Deck by May.',
      'rep.name': '—',
    });
  });
});

const LEGACY_HASH = '75212e4ec07d45db018e87a46c6198963fc9eb9b277a948ffaee22a5ff2cb1b4';

describe('contentHash', () => {
  it('ignores key order and lifecycle fields, but not content', () => {
    const a = composeAgreement(sources());
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(contentHash(reordered)).toBe(a.contentHash);
    expect(
      contentHash({
        ...a,
        status: AgreementStatus.Signed,
        purchasers: [{ ...a.purchasers[0]!, status: SignerStatus.Signed }],
      } as unknown as typeof a),
    ).toBe(a.contentHash);

    const changed = composeAgreement(
      sources({ terms: terms({ deposits: [{ label: 'on signing', amountCents: 2_500_001 }] }) }),
    );
    expect(changed.contentHash).not.toBe(a.contentHash);
    expect(
      composeAgreement(
        sources({
          purchasers: [
            { id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' },
            { id: 'pur-2', name: 'Ben Buyer' },
          ],
        }),
      ).contentHash,
    ).not.toBe(a.contentHash);
    expect(
      contentHash({ ...a, sections: [{ heading: 'Price', body: 'The price is $1.' }] }),
    ).not.toBe(a.contentHash);
  });

  it('the sales tax and the referral are signed content', () => {
    const taxed = quote({
      ...signedQuote,
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
    });
    const a = composeAgreement(sources({ revision: revisionDoc({ quote: taxed }) }));
    expect(a.contentHash).not.toBe(composeAgreement(sources()).contentHash);
    const variants = [
      { ...taxed, tax: { ...taxed.tax!, regionCode: 'NB', regionName: 'New Brunswick' } },
      {
        ...taxed,
        tax: { ...taxed.tax!, lines: [{ label: 'GST', ratePercent: 13, amountCents: 6_539_000 }] },
      },
      {
        ...taxed,
        tax: { ...taxed.tax!, lines: [{ ...taxed.tax!.lines[0]!, ratePercent: 12.999 }] },
      },
      { ...taxed, referral: { ...taxed.referral!, referrerName: 'Someone Else' } },
      { ...taxed, subtotalCents: 50_300_001 },
    ];
    for (const variant of variants) {
      expect(contentHash({ ...a, quote: variant }), JSON.stringify(variant)).not.toBe(
        a.contentHash,
      );
    }
  });

  it('agreements prepared before sales tax existed keep their fingerprint', () => {
    const legacy = composeAgreement(sources());
    expect(legacy.quote).not.toHaveProperty('tax');
    expect(legacy.quote).not.toHaveProperty('subtotalCents');
    expect(legacy.contentHash).toBe(LEGACY_HASH);
  });

  it('canonical JSON sorts keys and drops undefined values', () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: 'x' }], e: null })).toBe(
      '{"a":[{"c":"x"}],"b":1,"e":null}',
    );
  });
});
