import { describe, expect, it } from 'vitest';
import {
  amendmentApproveSchema,
  amendmentFileName,
  amendmentIssueSchema,
  amendmentPolicySchema,
  amendmentPriceSchema,
  amendmentRejectSchema,
  amendmentRequestSchema,
  amendmentSignSchema,
  AmendmentStatus,
  amendQuote,
  amendTerms,
  applyAmendment,
  ApprovalReason,
  approvalReasons,
  ChangeError,
  changeDeltas,
  DEFAULT_AMENDMENT_POLICY,
  isUnsignedAmendment,
  QuoteError,
  UNSIGNED_AMENDMENT_STATUSES,
  type AgreementTerms,
  type AmendmentPricingSource,
  type AmendmentState,
  type Catalog,
  type QuoteSnapshot,
} from '../src/index.js';

const CATALOG: Catalog = {
  areas: [
    { slug: 'kitchen', label: 'Kitchen', order: 1 },
    { slug: 'flooring', label: 'Flooring', order: 2 },
  ],
  items: [
    { id: 'island', areaSlug: 'kitchen', name: 'Island', priceCents: 500_000 },
    { id: 'hood', areaSlug: 'kitchen', name: 'Range hood', priceCents: 150_000 },
    { id: 'trim', areaSlug: 'kitchen', name: 'Trim', priceCents: 20_000, soldSeparately: false },
    { id: 'oak', areaSlug: 'flooring', name: 'Oak', priceCents: 800_000 },
    { id: 'tile', areaSlug: 'flooring', name: 'Tile', priceCents: 300_000 },
  ],
  packages: [
    {
      id: 'signature',
      areaSlug: 'kitchen',
      name: 'Signature',
      itemIds: ['island', 'hood'],
      priceCents: 900_000,
    },
    { id: 'chef', areaSlug: 'kitchen', name: 'Chef', itemIds: ['island'], priceCents: 1_400_000 },
  ],
};
const SOURCE: AmendmentPricingSource = { catalog: CATALOG, priceOverrides: [] };

/** Signed a year ago: Signature at $8,500 and oak at $7,000 (catalog prices have gone up since). */
const SIGNED_QUOTE: QuoteSnapshot = {
  houseId: 'house-1',
  houseName: 'The Aspen',
  currency: 'CAD',
  baseCents: 50_000_000,
  lines: [
    {
      areaSlug: 'kitchen',
      areaLabel: 'Kitchen',
      kind: 'package',
      refId: 'signature',
      name: 'Signature',
      unitCents: 850_000,
    },
    {
      areaSlug: 'flooring',
      areaLabel: 'Flooring',
      kind: 'item',
      refId: 'oak',
      name: 'Oak',
      unitCents: 700_000,
    },
  ],
  adjustments: [{ label: 'Model home promotion', amountCents: -200_000 }],
  referral: { programId: 'p', programName: 'Friends', referrerName: 'Kim', creditCents: 100_000 },
  subtotalCents: 51_250_000,
  tax: {
    regionCode: 'ON',
    regionName: 'Ontario',
    lines: [{ label: 'HST', ratePercent: 13, amountCents: 6_662_500 }],
    totalCents: 6_662_500,
  },
  totalCents: 57_912_500,
};
const TERMS: AgreementTerms = {
  deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
  depositCents: 2_500_000,
  conditions: [],
  closingDate: '2027-06-30',
};
const BEFORE: AmendmentState = {
  selections: { kitchen: { packageId: 'signature' }, flooring: { itemIds: ['oak'] } },
  quote: SIGNED_QUOTE,
  terms: TERMS,
};

describe('amendQuote', () => {
  it('leaves an unchanged home at exactly its signed price', () => {
    expect(amendQuote(BEFORE, BEFORE.selections, SOURCE)).toEqual(SIGNED_QUOTE);
  });

  it('prices what is added from today’s catalog, the plan’s own price first', () => {
    const selections = { ...BEFORE.selections, flooring: { itemIds: ['oak', 'tile'] } };
    const catalogPrice = amendQuote(BEFORE, selections, SOURCE);
    expect(catalogPrice.lines.at(-1)).toEqual({
      areaSlug: 'flooring',
      areaLabel: 'Flooring',
      kind: 'item',
      refId: 'tile',
      name: 'Tile',
      unitCents: 300_000,
    });
    expect(catalogPrice.lines.slice(0, 2)).toEqual(SIGNED_QUOTE.lines);
    expect(catalogPrice.subtotalCents).toBe(51_550_000);

    const planPrice = amendQuote(BEFORE, selections, {
      ...SOURCE,
      priceOverrides: [{ refId: 'tile', priceCents: 250_000 }],
    });
    expect(planPrice.lines.at(-1)?.unitCents).toBe(250_000);
  });

  it('credits what is removed at the price it was signed for, not today’s', () => {
    const q = amendQuote(BEFORE, { kitchen: { packageId: 'signature' } }, SOURCE);
    expect(q.lines.map((l) => l.refId)).toEqual(['signature']);
    expect(q.subtotalCents).toBe(51_250_000 - 700_000);
  });

  it('swaps a package: the old one credited as signed, the new one at today’s price', () => {
    const q = amendQuote(BEFORE, { ...BEFORE.selections, kitchen: { packageId: 'chef' } }, SOURCE);
    expect(q.lines.map((l) => [l.refId, l.unitCents])).toEqual([
      ['oak', 700_000],
      ['chef', 1_400_000],
    ]);
    expect(q.subtotalCents).toBe(51_250_000 - 850_000 + 1_400_000);
  });

  it('keeps options the catalog no longer offers at their signed price', () => {
    const discontinued = {
      ...SOURCE,
      catalog: { ...CATALOG, items: CATALOG.items.filter((i) => i.id !== 'oak') },
    };
    const selections = { ...BEFORE.selections, flooring: { itemIds: ['oak', 'tile'] } };
    expect(amendQuote(BEFORE, selections, discontinued).lines[1]).toEqual(SIGNED_QUOTE.lines[1]);
  });

  it('carries the base price, earlier adjustments and referral, and adds its own adjustments', () => {
    const q = amendQuote(BEFORE, BEFORE.selections, SOURCE, [
      { label: 'Change order fee', amountCents: 25_000 },
    ]);
    expect(q.baseCents).toBe(50_000_000);
    expect(q.referral).toEqual(SIGNED_QUOTE.referral);
    expect(q.adjustments).toEqual([
      ...SIGNED_QUOTE.adjustments,
      { label: 'Change order fee', amountCents: 25_000 },
    ]);
    expect(q.subtotalCents).toBe(51_275_000);
  });

  it('taxes the new price at the rate the agreement was signed with', () => {
    const q = amendQuote(BEFORE, { ...BEFORE.selections, flooring: { itemIds: [] } }, SOURCE);
    expect(q.subtotalCents).toBe(50_550_000);
    expect(q.tax).toEqual({
      regionCode: 'ON',
      regionName: 'Ontario',
      lines: [{ label: 'HST', ratePercent: 13, amountCents: 6_571_500 }],
      totalCents: 6_571_500,
    });
    expect(q.totalCents).toBe(57_121_500);
  });

  it('leaves an untaxed agreement untaxed', () => {
    const { tax: _tax, ...untaxed } = SIGNED_QUOTE;
    const q = amendQuote({ ...BEFORE, quote: { ...untaxed, totalCents: 51_250_000 } }, {}, SOURCE);
    expect(q.tax).toBeUndefined();
    expect(q.totalCents).toBe(q.subtotalCents);
  });

  it('refuses an option the catalog does not offer, one not sold alone, and a negative price', () => {
    const add = (itemIds: string[]) =>
      amendQuote(BEFORE, { ...BEFORE.selections, kitchen: { itemIds } }, SOURCE);
    expect(() => add(['ghost'])).toThrow(QuoteError);
    expect(() => add(['trim'])).toThrow(/only sold as part of a package/);
    expect(() => amendQuote(BEFORE, { attic: { itemIds: ['oak'] } }, SOURCE)).toThrow(
      /Unknown area/,
    );
    expect(() =>
      amendQuote(BEFORE, BEFORE.selections, SOURCE, [
        { label: 'Goodwill credit', amountCents: -60_000_000 },
      ]),
    ).toThrow(/cannot be negative/);
  });
});

describe('applyAmendment', () => {
  it('applies the changes, prices them and adds its instalments to the terms', () => {
    const after = applyAmendment(
      BEFORE,
      [
        { type: 'set_package', areaSlug: 'kitchen', packageId: 'chef' },
        { type: 'add_item', areaSlug: 'flooring', itemId: 'tile' },
      ],
      SOURCE,
      {
        adjustments: [{ label: 'Change order fee', amountCents: 25_000 }],
        deposits: [{ label: 'Change order payment', amountCents: 500_000 }],
      },
    );
    expect(after.selections).toEqual({
      kitchen: { packageId: 'chef' },
      flooring: { itemIds: ['oak', 'tile'] },
    });
    expect(after.quote.subtotalCents).toBe(51_250_000 - 850_000 + 1_400_000 + 300_000 + 25_000);
    expect(after.terms.deposits).toEqual([
      ...TERMS.deposits,
      { label: 'Change order payment', amountCents: 500_000 },
    ]);
    expect(after.terms.depositCents).toBe(3_000_000);
  });

  it('moves the closing date with the changes', () => {
    const after = applyAmendment(BEFORE, [], SOURCE, { closingDate: '2027-08-15' });
    expect(after.terms.closingDate).toBe('2027-08-15');
    expect(after.quote).toEqual(SIGNED_QUOTE);
  });

  it('refuses a change that does not apply to the home as amended', () => {
    expect(() =>
      applyAmendment(
        BEFORE,
        [{ type: 'remove_item', areaSlug: 'flooring', itemId: 'tile' }],
        SOURCE,
      ),
    ).toThrow(ChangeError);
  });
});

describe('changeDeltas', () => {
  it('prices each change alone, before tax', () => {
    expect(
      changeDeltas(
        BEFORE,
        [
          { type: 'set_package', areaSlug: 'kitchen', packageId: 'chef' },
          { type: 'remove_item', areaSlug: 'flooring', itemId: 'oak' },
          { type: 'add_item', areaSlug: 'flooring', itemId: 'ghost' },
        ],
        SOURCE,
      ),
    ).toEqual([550_000, -700_000, 0]);
  });
});

describe('amendTerms', () => {
  it('moves the closing date when the amendment sets one', () => {
    expect(amendTerms(TERMS, [], '2027-09-01')).toEqual({ ...TERMS, closingDate: '2027-09-01' });
    expect(amendTerms({ ...TERMS, closingDate: undefined }, [], '2027-09-01').closingDate).toBe(
      '2027-09-01',
    );
    expect(amendTerms(TERMS, [], undefined)).toBe(TERMS);
  });

  it('keeps the terms and totals the deposit with the added instalments', () => {
    expect(amendTerms(TERMS, [])).toEqual(TERMS);
    expect(
      amendTerms(TERMS, [
        { label: 'Upgrade payment', amountCents: 100_000, dueDate: '2027-01-15' },
      ]),
    ).toEqual({
      ...TERMS,
      deposits: [
        ...TERMS.deposits,
        { label: 'Upgrade payment', amountCents: 100_000, dueDate: '2027-01-15' },
      ],
      depositCents: 2_600_000,
    });
  });
});

describe('approvalReasons', () => {
  const quoteOf = (totalCents: number): QuoteSnapshot => ({ ...SIGNED_QUOTE, totalCents });
  const reasons = (
    after: number,
    { adjustments = [] as { label: string; amountCents: number }[], held = 0, policy = {} } = {},
  ) =>
    approvalReasons(
      { ...DEFAULT_AMENDMENT_POLICY, ...policy },
      { before: quoteOf(1_000_000), after: quoteOf(after), adjustments, heldCents: held },
    );

  it('needs no approval for catalog changes that add to the price', () => {
    expect(reasons(1_300_000)).toEqual([]);
  });

  it('by default, needs approval for a credit and for any fee or credit set by hand', () => {
    expect(DEFAULT_AMENDMENT_POLICY).toEqual({
      approveCredits: true,
      approveAdjustments: true,
      approveAboveCents: null,
    });
    expect(reasons(900_000)).toEqual([ApprovalReason.Credit]);
    expect(reasons(1_100_000, { adjustments: [{ label: 'Fee', amountCents: 100_000 }] })).toEqual([
      ApprovalReason.Adjustment,
    ]);
  });

  it('follows the company policy', () => {
    const lenient = { approveCredits: false, approveAdjustments: false };
    expect(reasons(900_000, { policy: lenient })).toEqual([]);
    const capped = { ...lenient, approveAboveCents: 200_000 };
    expect(reasons(1_200_000, { policy: capped })).toEqual([]);
    expect(reasons(1_200_001, { policy: capped })).toEqual([ApprovalReason.AboveThreshold]);
    expect(reasons(799_999, { policy: capped })).toEqual([ApprovalReason.AboveThreshold]);
  });

  it('always needs approval when the new price is below the money already received', () => {
    const lenient = { approveCredits: false, approveAdjustments: false };
    expect(reasons(900_000, { held: 950_000, policy: lenient })).toEqual([
      ApprovalReason.RefundDue,
    ]);
    expect(reasons(900_000, { held: 950_000 })).toEqual([
      ApprovalReason.Credit,
      ApprovalReason.RefundDue,
    ]);
  });
});

describe('statuses', () => {
  it('can be priced, declined or withdrawn until every purchaser has signed', () => {
    expect(UNSIGNED_AMENDMENT_STATUSES).toEqual([
      AmendmentStatus.Requested,
      AmendmentStatus.Priced,
      AmendmentStatus.UnderReview,
    ]);
    expect(isUnsignedAmendment(AmendmentStatus.UnderReview)).toBe(true);
    expect(isUnsignedAmendment(AmendmentStatus.AwaitingApproval)).toBe(false);
  });
});

describe('schemas', () => {
  const hash = 'a'.repeat(64);
  it('a request picks catalog changes, describes the change in words, or both', () => {
    expect(amendmentRequestSchema.safeParse({ changes: [] }).success).toBe(false);
    expect(amendmentRequestSchema.safeParse({ note: '   ' }).success).toBe(false);
    expect(amendmentRequestSchema.parse({ note: ' Wider patio door ' })).toEqual({
      changes: [],
      note: 'Wider patio door',
    });
    expect(
      amendmentRequestSchema.parse({
        changes: [{ type: 'add_item', areaSlug: 'flooring', itemId: 'tile' }],
        note: '  Tile in the mudroom too  ',
      }),
    ).toEqual({
      changes: [{ type: 'add_item', areaSlug: 'flooring', itemId: 'tile' }],
      note: 'Tile in the mudroom too',
    });
  });

  it('pricing decides each change and may add catalog changes, fees, credits and instalments', () => {
    expect(amendmentPriceSchema.parse({ decisions: [{ changeId: 'c1', approved: true }] })).toEqual(
      { decisions: [{ changeId: 'c1', approved: true }], added: [], adjustments: [], deposits: [] },
    );
    expect(
      amendmentPriceSchema.parse({
        added: [{ type: 'add_item', areaSlug: 'flooring', itemId: 'tile' }],
      }),
    ).toEqual({
      decisions: [],
      added: [{ type: 'add_item', areaSlug: 'flooring', itemId: 'tile' }],
      adjustments: [],
      deposits: [],
    });
    expect(
      amendmentPriceSchema.safeParse({
        decisions: [{ changeId: 'c1', approved: true }],
        deposits: [{ label: 'x', amountCents: 0 }],
      }).success,
    ).toBe(false);
  });

  it('pricing may move the closing date to a real calendar day', () => {
    expect(amendmentPriceSchema.parse({ closingDate: '2027-08-15' }).closingDate).toBe(
      '2027-08-15',
    );
    expect(amendmentPriceSchema.safeParse({ closingDate: '2027-02-30' }).success).toBe(false);
  });

  it('sending, signing and approving each sign the exact content', () => {
    const signed = { contentHash: hash, fullName: 'Sam Staff', agree: true };
    for (const schema of [amendmentIssueSchema, amendmentSignSchema, amendmentApproveSchema]) {
      expect(schema.parse(signed)).toMatchObject(signed);
      expect(schema.safeParse({ ...signed, agree: false }).success).toBe(false);
      expect(schema.safeParse({ ...signed, contentHash: 'nope' }).success).toBe(false);
    }
  });

  it('a rejection gives its reason', () => {
    expect(amendmentRejectSchema.safeParse({ reason: 'no' }).success).toBe(false);
    expect(amendmentRejectSchema.parse({ reason: ' Below cost ' })).toEqual({
      reason: 'Below cost',
    });
  });

  it('the policy defaults to approving credits and adjustments, with no threshold', () => {
    expect(amendmentPolicySchema.parse({})).toEqual(DEFAULT_AMENDMENT_POLICY);
    expect(amendmentPolicySchema.safeParse({ approveAboveCents: 0 }).success).toBe(false);
  });
});

describe('amendmentFileName', () => {
  it('marks the PDF of an amendment that is not executed yet', () => {
    expect(amendmentFileName('CO-AAAA-BBBB', AmendmentStatus.Executed)).toBe(
      'CO-AAAA-BBBB-executed.pdf',
    );
    expect(amendmentFileName('CO-AAAA-BBBB', AmendmentStatus.UnderReview)).toBe(
      'CO-AAAA-BBBB-draft.pdf',
    );
  });
});
