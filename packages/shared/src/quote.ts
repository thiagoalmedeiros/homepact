import { z } from 'zod';
import type { Catalog } from './catalog.js';
import type { House } from './house.js';
import { QUOTE_ERRORS } from './messages.js';
import { centsSchema, type Currency } from './money.js';
import { referralInputSchema, type QuoteReferral } from './referral.js';
import { computeTax, regionCodeSchema, type QuoteTax, type SalesTaxRate } from './sales-tax.js';

export const selectionSchema = z.union([
  z.strictObject({ packageId: z.string().min(1) }),
  z.strictObject({ itemIds: z.array(z.string().min(1)) }),
]);
export type Selection = z.infer<typeof selectionSchema>;
export const selectionsSchema = z.record(z.string(), selectionSchema);
export type Selections = z.infer<typeof selectionsSchema>;

export const adjustmentSchema = z.object({
  label: z.string().trim().min(1).max(120),
  amountCents: centsSchema,
});
export type Adjustment = z.infer<typeof adjustmentSchema>;

export const taxRegionSchema = regionCodeSchema.nullable().optional();

export const quoteRequestSchema = z.object({
  selections: selectionsSchema.default({}),
  adjustments: z.array(adjustmentSchema).max(20).default([]),
  taxRegion: taxRegionSchema,
  referral: referralInputSchema.optional(),
});

export interface QuoteLine {
  areaSlug: string;
  areaLabel: string;
  kind: 'package' | 'item';
  refId: string;
  name: string;
  unitCents: number;
}

export interface QuoteSnapshot {
  houseId: string;
  houseName: string;
  currency: Currency;
  baseCents: number;
  lines: QuoteLine[];
  adjustments: Adjustment[];
  referral?: QuoteReferral;
  subtotalCents?: number;
  tax?: QuoteTax;
  totalCents: number;
}

export interface QuoteExtras {
  referral?: QuoteReferral | null;
  tax?: SalesTaxRate | null;
}

/** Price before tax (older quotes had no tax, so their total is that price). */
export const priceBeforeTax = (q: Pick<QuoteSnapshot, 'subtotalCents' | 'totalCents'>): number =>
  q.subtotalCents ?? q.totalCents;

/** Sales tax on a quote; zero when none applied. */
export const salesTaxOf = (q: Pick<QuoteSnapshot, 'tax'>): number => q.tax?.totalCents ?? 0;

export type QuoteErrorCode =
  'UNKNOWN_AREA' | 'UNKNOWN_OPTION' | 'NOT_SOLD_SEPARATELY' | 'MIXED_SELECTION' | 'NEGATIVE_TOTAL';

export class QuoteError extends Error {
  constructor(
    readonly code: QuoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuoteError';
  }
}

type QuoteHouse = Pick<House, 'id' | 'name' | 'basePriceCents'> & {
  priceOverrides?: House['priceOverrides'];
};

export const sumQuote = (
  baseCents: number,
  lines: Pick<QuoteLine, 'unitCents'>[],
  adjustments: Adjustment[],
): number =>
  baseCents +
  lines.reduce((t, l) => t + l.unitCents, 0) +
  adjustments.reduce((t, a) => t + a.amountCents, 0);

/** Prices a configuration (plan overrides over catalog prices), less the referral credit, plus
 * the province's sales tax. Throws `QuoteError` on invalid options or a negative price. */
export const computeQuote = (
  house: QuoteHouse,
  catalog: Pick<Catalog, 'areas' | 'items' | 'packages'>,
  selections: Selections,
  currency: Currency,
  adjustments: Adjustment[] = [],
  { referral, tax }: QuoteExtras = {},
): QuoteSnapshot => {
  const lines: QuoteLine[] = [];
  const areaBySlug = new Map(catalog.areas.map((a) => [a.slug, a]));
  const override = new Map((house.priceOverrides ?? []).map((o) => [o.refId, o.priceCents]));

  const entries = Object.entries(selections).sort(
    ([a], [b]) => (areaBySlug.get(a)?.order ?? 0) - (areaBySlug.get(b)?.order ?? 0),
  );

  for (const [areaSlug, selection] of entries) {
    const area = areaBySlug.get(areaSlug);
    if (!area) throw new QuoteError('UNKNOWN_AREA', QUOTE_ERRORS.unknownArea(areaSlug));

    const raw = selection as Record<string, unknown>;
    if ('packageId' in raw && 'itemIds' in raw) {
      throw new QuoteError('MIXED_SELECTION', QUOTE_ERRORS.mixedSelection(area.label));
    }

    if ('packageId' in selection) {
      const pkg = catalog.packages.find(
        (p) => p.id === selection.packageId && p.areaSlug === areaSlug,
      );
      if (!pkg) throw new QuoteError('UNKNOWN_OPTION', QUOTE_ERRORS.packageNotInArea(area.label));
      lines.push({
        areaSlug,
        areaLabel: area.label,
        kind: 'package',
        refId: pkg.id,
        name: pkg.name,
        unitCents: override.get(pkg.id) ?? pkg.priceCents,
      });
      continue;
    }

    for (const itemId of new Set(selection.itemIds)) {
      const item = catalog.items.find((i) => i.id === itemId && i.areaSlug === areaSlug);
      if (!item) throw new QuoteError('UNKNOWN_OPTION', QUOTE_ERRORS.itemNotInArea(area.label));
      if (item.soldSeparately === false) {
        throw new QuoteError('NOT_SOLD_SEPARATELY', QUOTE_ERRORS.notSoldSeparately(item.name));
      }
      lines.push({
        areaSlug,
        areaLabel: area.label,
        kind: 'item',
        refId: item.id,
        name: item.name,
        unitCents: override.get(item.id) ?? item.priceCents,
      });
    }
  }

  const subtotalCents =
    sumQuote(house.basePriceCents, lines, adjustments) - (referral?.creditCents ?? 0);
  if (subtotalCents < 0) throw new QuoteError('NEGATIVE_TOTAL', QUOTE_ERRORS.negativeTotal);
  const salesTax = tax ? computeTax(subtotalCents, tax) : undefined;

  return {
    houseId: house.id,
    houseName: house.name,
    currency,
    baseCents: house.basePriceCents,
    lines,
    adjustments,
    ...(referral && { referral }),
    subtotalCents,
    ...(salesTax && { tax: salesTax }),
    totalCents: subtotalCents + (salesTax?.totalCents ?? 0),
  };
};
