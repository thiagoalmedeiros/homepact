import { z } from 'zod';
import { VALIDATION } from './messages.js';

/** "9.975" is fine, "9.9751" is not: rates are stored in thousandths of a percent. */
const hasAtMostThreeDecimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

export const taxRatePercentSchema = z
  .number()
  .min(0)
  .max(100)
  .refine(hasAtMostThreeDecimals, VALIDATION.taxRateDecimals);

export const taxComponentSchema = z.object({
  label: z.string().trim().min(1).max(40),
  ratePercent: taxRatePercentSchema,
});
export type TaxComponent = z.output<typeof taxComponentSchema>;

export const regionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,6}$/, VALIDATION.regionCode);

const salesTaxShape = {
  code: regionCodeSchema,
  name: z.string().trim().min(1).max(80),
  components: z.array(taxComponentSchema).min(1).max(4),
};

export const taxPresetInputSchema = z.object({
  ...salesTaxShape,
  note: z.string().trim().max(300).optional(),
});
export type TaxPresetInput = z.input<typeof taxPresetInputSchema>;

export interface TaxPreset {
  id: string;
  code: string;
  name: string;
  components: TaxComponent[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export const taxRateInputSchema = z.object({
  ...salesTaxShape,
  isDefault: z.boolean().default(false),
});
export type TaxRateInput = z.input<typeof taxRateInputSchema>;

export const taxRateAdoptSchema = z.object({
  presetId: z.string().min(1),
  isDefault: z.boolean().default(false),
});
export type TaxRateAdopt = z.input<typeof taxRateAdoptSchema>;

export interface TaxRate {
  id: string;
  code: string;
  name: string;
  components: TaxComponent[];
  isDefault: boolean;
  presetId?: string;
  createdAt: string;
  updatedAt: string;
}

export type SalesTaxRate = Pick<TaxRate, 'code' | 'name' | 'components'>;

export interface QuoteTaxLine {
  label: string;
  ratePercent: number;
  amountCents: number;
}

export interface QuoteTax {
  regionCode: string;
  regionName: string;
  lines: QuoteTaxLine[];
  totalCents: number;
}

/** Tax on an amount in integer thousandths of a percent, rounded once to the cent (half up). */
export const taxOn = (amountCents: number, ratePercent: number): number => {
  const thousandths = Math.round(ratePercent * 1000);
  return Math.round((amountCents * thousandths) / 100_000);
};

/** Each tax of the province on the price before tax; every line is rounded on its own. */
export const computeTax = (subtotalCents: number, rate: SalesTaxRate): QuoteTax => {
  const lines = rate.components.map((c) => ({
    label: c.label,
    ratePercent: c.ratePercent,
    amountCents: taxOn(subtotalCents, c.ratePercent),
  }));
  return {
    regionCode: rate.code,
    regionName: rate.name,
    lines,
    totalCents: lines.reduce((t, l) => t + l.amountCents, 0),
  };
};

/** The rate a quote was priced with, for re-pricing when the company no longer has it. */
export const rateOfQuoteTax = (tax: QuoteTax): SalesTaxRate => ({
  code: tax.regionCode,
  name: tax.regionName,
  components: tax.lines.map((l) => ({ label: l.label, ratePercent: l.ratePercent })),
});

/** Sum of a province's rates, e.g. 14.975 for Quebec. */
export const combinedRate = (components: Pick<TaxComponent, 'ratePercent'>[]): number =>
  components.reduce((t, c) => t + Math.round(c.ratePercent * 1000), 0) / 1000;

export const CANADIAN_TAX_PRESETS: readonly TaxPresetInput[] = [
  { code: 'AB', name: 'Alberta', components: [{ label: 'GST', ratePercent: 5 }] },
  {
    code: 'BC',
    name: 'British Columbia',
    components: [{ label: 'GST', ratePercent: 5 }],
    note: 'PST is not charged on the sale of a new home.',
  },
  {
    code: 'MB',
    name: 'Manitoba',
    components: [{ label: 'GST', ratePercent: 5 }],
    note: 'RST is not charged on the sale of a new home.',
  },
  { code: 'NB', name: 'New Brunswick', components: [{ label: 'HST', ratePercent: 15 }] },
  {
    code: 'NL',
    name: 'Newfoundland and Labrador',
    components: [{ label: 'HST', ratePercent: 15 }],
  },
  {
    code: 'NS',
    name: 'Nova Scotia',
    components: [{ label: 'HST', ratePercent: 14 }],
    note: 'HST went from 15% to 14% on April 1, 2025.',
  },
  { code: 'NT', name: 'Northwest Territories', components: [{ label: 'GST', ratePercent: 5 }] },
  { code: 'NU', name: 'Nunavut', components: [{ label: 'GST', ratePercent: 5 }] },
  { code: 'ON', name: 'Ontario', components: [{ label: 'HST', ratePercent: 13 }] },
  { code: 'PE', name: 'Prince Edward Island', components: [{ label: 'HST', ratePercent: 15 }] },
  {
    code: 'QC',
    name: 'Quebec',
    components: [
      { label: 'GST', ratePercent: 5 },
      { label: 'QST', ratePercent: 9.975 },
    ],
  },
  {
    code: 'SK',
    name: 'Saskatchewan',
    components: [{ label: 'GST', ratePercent: 5 }],
    note: 'PST (6%) is not included: add it if your contracts charge it to the buyer.',
  },
  { code: 'YT', name: 'Yukon', components: [{ label: 'GST', ratePercent: 5 }] },
];
