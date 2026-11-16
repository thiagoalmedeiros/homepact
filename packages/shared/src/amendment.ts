import { z } from 'zod';
import {
  agreementCountersignSchema,
  depositInstalmentSchema,
  type AgreementHome,
  type AgreementParty,
  type AgreementPurchaser,
  type AgreementSignature,
  type AgreementTerms,
  type DepositInstalment,
  type SignerInvitation,
} from './agreement.js';
import type { AgreementState } from './agreement-state.js';
import { applyChanges } from './changes.js';
import type { Catalog } from './catalog.js';
import {
  AmendmentAction,
  AmendmentStatus,
  ApprovalReason,
  type Party,
  type PrincipalRole,
} from './enums.js';
import type { PriceOverride } from './house.js';
import { QUOTE_ERRORS, VALIDATION } from './messages.js';
import { centsSchema, type Currency } from './money.js';
import { calendarDateSchema } from './schema-utils.js';
import { changeSchema, type Change, type RequestedChange } from './proposal.js';
import {
  adjustmentSchema,
  priceBeforeTax,
  QuoteError,
  sumQuote,
  type Adjustment,
  type QuoteLine,
  type QuoteSnapshot,
  type Selections,
} from './quote.js';
import { computeTax, rateOfQuoteTax } from './sales-tax.js';

/** The buyer picks options from the catalog, describes the change in words, or both. */
export const amendmentRequestSchema = z
  .object({
    changes: z.array(changeSchema).max(30).default([]),
    note: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((note) => note || undefined),
  })
  .refine((r) => r.changes.length > 0 || !!r.note, {
    message: VALIDATION.changesOrNote,
    path: ['changes'],
  });

export const amendmentPreviewSchema = z.object({
  changes: z.array(changeSchema).max(30),
});

/** Sales decides each change the buyer asked for and may add catalog changes of their own
 * (turning a request in words into options), fees or credits, and instalments. */
export const amendmentPriceSchema = z.object({
  decisions: z
    .array(
      z.object({
        changeId: z.string().min(1),
        approved: z.boolean(),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .default([]),
  added: z.array(changeSchema).max(30).default([]),
  closingDate: calendarDateSchema.optional(),
  adjustments: z.array(adjustmentSchema).max(10).default([]),
  deposits: z.array(depositInstalmentSchema).max(4).default([]),
  note: z.string().trim().max(4000).optional(),
});
export type AmendmentPricing = z.input<typeof amendmentPriceSchema>;

/** Sales sends it for signature and signs for the company; purchasers sign; an administrator
 * approves. Each one signs the exact content by its fingerprint. */
export const amendmentIssueSchema = agreementCountersignSchema;
export const amendmentSignSchema = agreementCountersignSchema;
export const amendmentApproveSchema = agreementCountersignSchema.extend({
  note: z.string().trim().max(1000).optional(),
});

export const amendmentRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const amendmentCloseSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const amendmentListQuerySchema = z.object({
  status: z.enum(AmendmentStatus).optional(),
});

/** When an amendment needs an administrator's approval, besides a refund always needing one. */
export const amendmentPolicySchema = z.object({
  approveCredits: z.boolean().default(true),
  approveAdjustments: z.boolean().default(true),
  approveAboveCents: centsSchema.min(1).nullable().default(null),
});
export type AmendmentPolicy = z.output<typeof amendmentPolicySchema>;

export const DEFAULT_AMENDMENT_POLICY: AmendmentPolicy = {
  approveCredits: true,
  approveAdjustments: true,
  approveAboveCents: null,
};

/** The home, its price and its terms at one point of the agreement's life. */
export interface AmendmentState {
  selections: Selections;
  quote: QuoteSnapshot;
  terms: AgreementTerms;
}

/** A change on an amendment: asked by the buyer, or added by sales while drafting it. */
export interface AmendmentChange extends RequestedChange {
  addedBySeller?: true;
}

export interface AmendmentActor {
  id: string;
  name: string;
  role: PrincipalRole;
}

export interface AmendmentEvent {
  at: string;
  by: AmendmentActor;
  action: AmendmentAction;
  reason?: string;
}

export interface Amendment {
  id: string;
  reference: string;
  /** Its place in the agreement's amendments: executed ones are numbered 1 to n. */
  number: number;
  agreementId: string;
  agreementReference: string;
  proposalId: string;
  status: AmendmentStatus;
  /** What it amends: the agreement as signed (0) or the amendment before it, by fingerprint. */
  basis: { number: number; contentHash: string };
  requestedBy: { party: Party.Buyer | Party.Seller; name: string };
  note?: string;
  changes: AmendmentChange[];
  adjustments: Adjustment[];
  deposits: DepositInstalment[];
  /** The new closing and possession date, when it moves it. */
  closingDate?: string;
  before: AmendmentState;
  after?: AmendmentState;
  pricingNote?: string;
  approval?: { required: boolean; reasons: ApprovalReason[] };
  seller: AgreementParty;
  home: AgreementHome;
  purchasers: AgreementPurchaser[];
  currency: Currency;
  contentHash?: string;
  pricedAt?: string;
  pricedBy?: AmendmentActor;
  issuedAt?: string;
  issuedBy?: AmendmentActor;
  sellerSignature?: AgreementSignature;
  signedAt?: string;
  approvedAt?: string;
  approvedBy?: AmendmentActor;
  approvalSignature?: AgreementSignature;
  approvalNote?: string;
  executedAt?: string;
  executedPdf?: { sha256: string; size: number };
  closedAt?: string;
  closedBy?: AmendmentActor;
  closeReason?: string;
  history: AmendmentEvent[];
  createdAt: string;
  updatedAt: string;
  viewerPurchaserId?: string;
}

export interface AmendmentSummary {
  id: string;
  reference: string;
  number: number;
  agreementId: string;
  agreementReference: string;
  status: AmendmentStatus;
  changeCount: number;
  beforeTotalCents: number;
  afterTotalCents?: number;
  currency: Currency;
  approvalReasons: ApprovalReason[];
  createdAt: string;
  updatedAt: string;
}

export interface AmendmentIssued {
  amendment: Amendment;
  invitations: SignerInvitation[];
}

/** A draft as sales shapes it, priced but not saved. */
export interface AmendmentDraftPreview {
  changes: AmendmentChange[];
  after: AmendmentState;
  approval: { required: boolean; reasons: ApprovalReason[] };
}

export interface AmendmentPreview {
  quote: QuoteSnapshot;
  changes: { label: string; deltaCents: number }[];
}

/** Where an agreement stands, with the selections its next amendment starts from. */
export interface AgreementCurrent {
  state: AgreementState;
  selections: Selections;
  openAmendmentId?: string;
  /** The home was sold as-is: only sales can open a change order. */
  offeredAsIs?: true;
}

/** What an amendment is priced against: today's catalog and the plan's own prices. */
export interface AmendmentPricingSource {
  catalog: Pick<Catalog, 'areas' | 'items' | 'packages'>;
  priceOverrides?: readonly PriceOverride[];
}

type WantedLine = Pick<QuoteLine, 'areaSlug' | 'kind' | 'refId'>;

const lineKey = (l: WantedLine) => `${l.areaSlug}\u0000${l.kind}\u0000${l.refId}`;

/** The lines a configuration asks for, in selection order. */
const wantedLines = (selections: Selections): WantedLine[] =>
  Object.entries(selections).flatMap(([areaSlug, selection]): WantedLine[] =>
    'packageId' in selection
      ? [{ areaSlug, kind: 'package', refId: selection.packageId }]
      : [...new Set(selection.itemIds)].map((refId) => ({ areaSlug, kind: 'item', refId })),
  );

/** A line the signed price does not have yet, at today's price (the plan's own first). */
const priceNewLine = (
  wanted: WantedLine,
  { catalog, priceOverrides = [] }: AmendmentPricingSource,
): QuoteLine => {
  const area = catalog.areas.find((a) => a.slug === wanted.areaSlug);
  if (!area) throw new QuoteError('UNKNOWN_AREA', QUOTE_ERRORS.unknownArea(wanted.areaSlug));
  const override = priceOverrides.find((o) => o.refId === wanted.refId)?.priceCents;
  if (wanted.kind === 'package') {
    const pkg = catalog.packages.find((p) => p.id === wanted.refId && p.areaSlug === area.slug);
    if (!pkg) throw new QuoteError('UNKNOWN_OPTION', QUOTE_ERRORS.packageNotInArea(area.label));
    return {
      ...wanted,
      areaLabel: area.label,
      name: pkg.name,
      unitCents: override ?? pkg.priceCents,
    };
  }
  const item = catalog.items.find((i) => i.id === wanted.refId && i.areaSlug === area.slug);
  if (!item) throw new QuoteError('UNKNOWN_OPTION', QUOTE_ERRORS.itemNotInArea(area.label));
  if (item.soldSeparately === false) {
    throw new QuoteError('NOT_SOLD_SEPARATELY', QUOTE_ERRORS.notSoldSeparately(item.name));
  }
  return {
    ...wanted,
    areaLabel: area.label,
    name: item.name,
    unitCents: override ?? item.priceCents,
  };
};

const areaOrder = (source: AmendmentPricingSource, slug: string) =>
  source.catalog.areas.find((a) => a.slug === slug)?.order ?? Number.MAX_SAFE_INTEGER;

/** Re-prices the home for new selections without re-pricing what was signed: options that stay
 * keep their signed price (even if the catalog dropped them), options added are priced today,
 * options removed are credited at their signed price. Base price, adjustments, referral and
 * province carry over, with the amendment's own adjustments added and tax at the signed rate.
 * Throws `QuoteError` for an option not on offer or a negative price. */
export const amendQuote = (
  before: Pick<AmendmentState, 'quote'>,
  selections: Selections,
  source: AmendmentPricingSource,
  adjustments: readonly Adjustment[] = [],
): QuoteSnapshot => {
  const q = before.quote;
  const wanted = wantedLines(selections);
  const wantedKeys = new Set(wanted.map(lineKey));
  const signedKeys = new Set(q.lines.map(lineKey));
  const kept = q.lines.filter((l) => wantedKeys.has(lineKey(l)));
  const added = wanted
    .filter((w) => !signedKeys.has(lineKey(w)))
    .map((w) => priceNewLine(w, source))
    .sort((a, b) => areaOrder(source, a.areaSlug) - areaOrder(source, b.areaSlug));
  const lines = [...kept, ...added];
  const allAdjustments = [...q.adjustments, ...adjustments];
  const subtotalCents =
    sumQuote(q.baseCents, lines, allAdjustments) - (q.referral?.creditCents ?? 0);
  if (subtotalCents < 0) throw new QuoteError('NEGATIVE_TOTAL', QUOTE_ERRORS.negativeTotal);
  const tax = q.tax ? computeTax(subtotalCents, rateOfQuoteTax(q.tax)) : undefined;
  return {
    houseId: q.houseId,
    houseName: q.houseName,
    currency: q.currency,
    baseCents: q.baseCents,
    lines,
    adjustments: allAdjustments,
    ...(q.referral && { referral: q.referral }),
    subtotalCents,
    ...(tax && { tax }),
    totalCents: subtotalCents + (tax?.totalCents ?? 0),
  };
};

/** The terms with the amendment's instalments added to the deposit schedule and, when it sets
 * one, its new closing date. */
export const amendTerms = (
  terms: AgreementTerms,
  added: readonly DepositInstalment[],
  closingDate?: string,
): AgreementTerms => {
  const moved = closingDate ? { ...terms, closingDate } : terms;
  if (!added.length) return moved;
  const deposits = [
    ...terms.deposits,
    ...added.map((d) => ({
      label: d.label,
      amountCents: d.amountCents,
      ...(d.dueDate && { dueDate: d.dueDate }),
    })),
  ];
  return {
    ...moved,
    deposits,
    depositCents: deposits.reduce((total, d) => total + d.amountCents, 0),
  };
};

const packageContents = (catalog: AmendmentPricingSource['catalog']) => (packageId: string) =>
  catalog.packages.find((p) => p.id === packageId)?.itemIds;

/** The state after the changes, fees, credits and added instalments. Throws `ChangeError` for a
 * change that does not apply, `QuoteError` for one that cannot be priced. */
export const applyAmendment = (
  before: AmendmentState,
  changes: readonly Change[],
  source: AmendmentPricingSource,
  extras: {
    adjustments?: readonly Adjustment[];
    deposits?: readonly DepositInstalment[];
    closingDate?: string | undefined;
  } = {},
): AmendmentState => {
  const selections = applyChanges(before.selections, [...changes], packageContents(source.catalog));
  return {
    selections,
    quote: amendQuote(before, selections, source, extras.adjustments),
    terms: amendTerms(before.terms, extras.deposits ?? [], extras.closingDate),
  };
};

/** What each change alone adds to the price before tax; 0 for one that only applies with
 * others. */
export const changeDeltas = (
  before: AmendmentState,
  changes: readonly Change[],
  source: AmendmentPricingSource,
): number[] =>
  changes.map((change) => {
    try {
      const alone = applyAmendment(before, [change], source);
      return priceBeforeTax(alone.quote) - priceBeforeTax(before.quote);
    } catch {
      return 0;
    }
  });

/** Why an amendment needs approval under the policy; a price below the money already received
 * always does, since the difference is owed back. */
export const approvalReasons = (
  policy: AmendmentPolicy,
  {
    before,
    after,
    adjustments,
    heldCents,
  }: {
    before: Pick<QuoteSnapshot, 'totalCents'>;
    after: Pick<QuoteSnapshot, 'totalCents'>;
    adjustments: readonly Adjustment[];
    heldCents: number;
  },
): ApprovalReason[] => {
  const change = after.totalCents - before.totalCents;
  return [
    ...(policy.approveCredits && change < 0 ? [ApprovalReason.Credit] : []),
    ...(policy.approveAdjustments && adjustments.length ? [ApprovalReason.Adjustment] : []),
    ...(policy.approveAboveCents !== null && Math.abs(change) > policy.approveAboveCents
      ? [ApprovalReason.AboveThreshold]
      : []),
    ...(after.totalCents < heldCents ? [ApprovalReason.RefundDue] : []),
  ];
};
