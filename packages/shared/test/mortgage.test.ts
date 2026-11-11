import { describe, expect, it } from 'vitest';
import {
  estimateMortgage,
  insurancePremiumRatePercent,
  minimumDownPaymentCents,
  ratePerPayment,
  type MortgageInput,
} from '../src/mortgage.js';

const base: MortgageInput = {
  priceCents: 62_500_000,
  downPaymentCents: 12_500_000,
  ratePercent: 5,
  amortizationYears: 25,
  frequency: 'monthly',
};

describe('minimumDownPaymentCents', () => {
  it('is 5% of the first $500,000 and 10% above, then 20% from $1.5M', () => {
    expect(minimumDownPaymentCents(40_000_000)).toBe(2_000_000);
    expect(minimumDownPaymentCents(70_000_000)).toBe(4_500_000);
    expect(minimumDownPaymentCents(149_999_999)).toBe(12_500_000);
    expect(minimumDownPaymentCents(150_000_000)).toBe(30_000_000);
  });
});

describe('payments', () => {
  it('compounds semi-annually, as Canadian fixed rates do', () => {
    expect(ratePerPayment(5, 2)).toBeCloseTo(0.025, 12);
    const monthly = estimateMortgage(base);
    expect(monthly.mortgageCents).toBe(50_000_000);
    expect(monthly.paymentCents).toBe(290_802);
    expect(monthly.totalInterestCents).toBe(37_240_748);
    expect(monthly.yearsToPayOff).toBeCloseTo(25, 6);
  });

  it('bi-weekly and weekly spread the same amortization; accelerated pays it off sooner', () => {
    expect(estimateMortgage({ ...base, frequency: 'biweekly' }).paymentCents).toBe(134_068);
    expect(estimateMortgage({ ...base, frequency: 'weekly' }).paymentCents).toBe(67_002);
    const accelerated = estimateMortgage({ ...base, frequency: 'acceleratedBiweekly' });
    expect(accelerated.paymentCents).toBe(145_401);
    expect(accelerated.yearsToPayOff).toBeCloseTo(21.478, 3);
    expect(accelerated.totalInterestCents).toBe(31_197_128);
  });

  it('a zero rate repays the principal evenly', () => {
    const free = estimateMortgage({ ...base, ratePercent: 0 });
    expect(free.paymentCents).toBe(166_667);
    expect(free.totalInterestCents).toBe(0);
  });
});

describe('mortgage insurance', () => {
  const insured = { ...base, priceCents: 60_000_000, downPaymentCents: 6_000_000 };

  it('is added to the loan below 20% down, with the provincial tax on the premium apart', () => {
    const e = estimateMortgage({ ...insured, ratePercent: 4.79, regionCode: 'ON' });
    expect(e.loanToValuePercent).toBe(90);
    expect(e.insurancePremiumRatePercent).toBe(3.1);
    expect(e.insurancePremiumCents).toBe(1_674_000);
    expect(e.mortgageCents).toBe(55_674_000);
    expect(e.premiumSalesTaxCents).toBe(133_920);
    expect(e.paymentCents).toBe(317_179);
    expect(estimateMortgage({ ...insured, regionCode: 'AB' }).premiumSalesTaxCents).toBe(0);
  });

  it('follows the premium tiers, with a surcharge beyond 25 years', () => {
    expect(insurancePremiumRatePercent(80, 25)).toBe(0);
    expect(insurancePremiumRatePercent(85, 25)).toBe(2.8);
    expect(insurancePremiumRatePercent(90, 25)).toBe(3.1);
    expect(insurancePremiumRatePercent(95, 25)).toBe(4);
    expect(insurancePremiumRatePercent(90, 30)).toBe(3.3);
    expect(estimateMortgage({ ...insured, amortizationYears: 30 }).insurancePremiumCents).toBe(
      1_782_000,
    );
  });

  it('flags a down payment under the minimum, and never insures from $1.5M', () => {
    expect(
      estimateMortgage({ ...insured, downPaymentCents: 2_000_000 }).belowMinimumDownPayment,
    ).toBe(true);
    const expensive = estimateMortgage({
      ...base,
      priceCents: 160_000_000,
      downPaymentCents: 16_000_000,
    });
    expect(expensive.belowMinimumDownPayment).toBe(true);
    expect(expensive.insurancePremiumCents).toBe(0);
  });
});
