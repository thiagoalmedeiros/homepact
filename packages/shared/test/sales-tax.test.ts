import { describe, expect, it } from 'vitest';
import {
  CANADIAN_TAX_PRESETS,
  combinedRate,
  computeTax,
  rateOfQuoteTax,
  taxOn,
  taxPresetInputSchema,
  taxRateInputSchema,
} from '../src/index.js';

describe('taxOn', () => {
  it('is exact to the thousandth of a percent, rounded once, half up', () => {
    expect(taxOn(100_000_00, 13)).toBe(13_000_00);
    expect(taxOn(100_000_00, 9.975)).toBe(9_975_00);
    expect(taxOn(150, 5)).toBe(8);
    expect(taxOn(0, 15)).toBe(0);
    expect(taxOn(99_999_999_99, 9.975)).toBe(997_500_000);
  });
});

describe('computeTax', () => {
  it('keeps the province and one line per tax, and rebuilds the rate it used', () => {
    const rate = {
      code: 'QC',
      name: 'Quebec',
      components: [
        { label: 'GST', ratePercent: 5 },
        { label: 'QST', ratePercent: 9.975 },
      ],
    };
    const tax = computeTax(50_000_000, rate);
    expect(tax).toEqual({
      regionCode: 'QC',
      regionName: 'Quebec',
      lines: [
        { label: 'GST', ratePercent: 5, amountCents: 2_500_000 },
        { label: 'QST', ratePercent: 9.975, amountCents: 4_987_500 },
      ],
      totalCents: 7_487_500,
    });
    expect(rateOfQuoteTax(tax)).toEqual(rate);
    expect(combinedRate(rate.components)).toBe(14.975);
  });
});

describe('tax schemas', () => {
  it('a rate has at most 3 decimals and sits between 0 and 100', () => {
    const rate = (ratePercent: number) =>
      taxRateInputSchema.safeParse({
        code: 'QC',
        name: 'Quebec',
        components: [{ label: 'QST', ratePercent }],
      }).success;
    expect(rate(9.975)).toBe(true);
    expect(rate(13)).toBe(true);
    expect(rate(9.9751)).toBe(false);
    expect(rate(-1)).toBe(false);
    expect(rate(101)).toBe(false);
  });

  it('the Canadian suggestions cover every province and territory once, and are valid', () => {
    expect(CANADIAN_TAX_PRESETS.map((p) => p.code).sort()).toEqual([
      'AB',
      'BC',
      'MB',
      'NB',
      'NL',
      'NS',
      'NT',
      'NU',
      'ON',
      'PE',
      'QC',
      'SK',
      'YT',
    ]);
    for (const preset of CANADIAN_TAX_PRESETS) {
      expect(taxPresetInputSchema.safeParse(preset).success, preset.code).toBe(true);
    }
    const rateOf = (code: string) =>
      combinedRate(CANADIAN_TAX_PRESETS.find((p) => p.code === code)!.components);
    expect(rateOf('ON')).toBe(13);
    expect(rateOf('QC')).toBe(14.975);
    expect(rateOf('AB')).toBe(5);
  });
});
