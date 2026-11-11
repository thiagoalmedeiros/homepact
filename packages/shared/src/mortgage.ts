export type PaymentFrequency = 'monthly' | 'biweekly' | 'acceleratedBiweekly' | 'weekly';

export const PAYMENT_FREQUENCIES: readonly PaymentFrequency[] = [
  'monthly',
  'biweekly',
  'acceleratedBiweekly',
  'weekly',
];

const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  biweekly: 26,
  acceleratedBiweekly: 26,
  weekly: 52,
};

export const CANADIAN_MORTGAGE_RULES = {
  insurablePriceBelowCents: 150_000_000,
  minimumDownPayment: { firstTierCents: 50_000_000, firstTierPercent: 5, abovePercent: 10 },
  uninsurableMinimumDownPercent: 20,
  insuranceAboveLoanToValuePercent: 80,
  premiumTiers: [
    { upToLoanToValuePercent: 85, ratePercent: 2.8 },
    { upToLoanToValuePercent: 90, ratePercent: 3.1 },
    { upToLoanToValuePercent: 95, ratePercent: 4 },
  ],
  longAmortization: { aboveYears: 25, surchargePercent: 0.2 },
  maxAmortizationYears: 30,
  premiumSalesTaxPercent: { ON: 8, QC: 9, SK: 6 } as Record<string, number>,
} as const;

export interface MortgageReferenceRate {
  seriesId: string;
  source: string;
  sourceUrl: string;
  ratePercent: number;
  asOf: string;
  history: { date: string; ratePercent: number }[];
}

export interface MortgageInput {
  priceCents: number;
  downPaymentCents: number;
  ratePercent: number;
  amortizationYears: number;
  frequency: PaymentFrequency;
  regionCode?: string | undefined;
}

export interface MortgageEstimate {
  minimumDownPaymentCents: number;
  belowMinimumDownPayment: boolean;
  loanToValuePercent: number;
  insurancePremiumRatePercent: number;
  insurancePremiumCents: number;
  premiumSalesTaxCents: number;
  mortgageCents: number;
  paymentCents: number;
  paymentsPerYear: number;
  yearsToPayOff: number;
  totalInterestCents: number;
}

const R = CANADIAN_MORTGAGE_RULES;

/** 5% of the first $500,000 and 10% above; 20% of the price from $1.5M, where insurance ends. */
export const minimumDownPaymentCents = (priceCents: number): number => {
  if (priceCents >= R.insurablePriceBelowCents) {
    return Math.ceil((priceCents * R.uninsurableMinimumDownPercent) / 100);
  }
  const { firstTierCents, firstTierPercent, abovePercent } = R.minimumDownPayment;
  const firstTier = Math.min(priceCents, firstTierCents);
  const above = Math.max(0, priceCents - firstTierCents);
  return Math.ceil((firstTier * firstTierPercent + above * abovePercent) / 100);
};

/** Fixed rates in Canada compound semi-annually, so the rate per payment follows from that. */
export const ratePerPayment = (annualRatePercent: number, paymentsPerYear: number): number =>
  Math.pow(1 + annualRatePercent / 200, 2 / paymentsPerYear) - 1;

const levelPayment = (principal: number, rate: number, payments: number): number =>
  rate === 0 ? principal / payments : (principal * rate) / (1 - Math.pow(1 + rate, -payments));

const paymentsToRepay = (principal: number, rate: number, payment: number): number =>
  rate === 0
    ? principal / payment
    : -Math.log(1 - (principal * rate) / payment) / Math.log(1 + rate);

/** Default insurance premium, as a percent of the loan; zero at 20% down or more. */
export const insurancePremiumRatePercent = (
  loanToValuePercent: number,
  amortizationYears: number,
): number => {
  if (loanToValuePercent <= R.insuranceAboveLoanToValuePercent) return 0;
  const tier =
    R.premiumTiers.find((t) => loanToValuePercent <= t.upToLoanToValuePercent) ??
    R.premiumTiers[R.premiumTiers.length - 1]!;
  const surcharge =
    amortizationYears > R.longAmortization.aboveYears ? R.longAmortization.surchargePercent : 0;
  return Math.round((tier.ratePercent + surcharge) * 1000) / 1000;
};

/** Estimates a mortgage under the Canadian rules of 2025 (check them when they change): minimum
 * down payment, default insurance added to the loan, and the payment; accelerated bi-weekly pays
 * half the monthly payment every two weeks. */
export const estimateMortgage = (input: MortgageInput): MortgageEstimate => {
  const price = Math.max(0, input.priceCents);
  const down = Math.min(Math.max(0, input.downPaymentCents), price);
  const minimum = minimumDownPaymentCents(price);
  const loan = price - down;
  const loanToValuePercent = price ? (loan / price) * 100 : 0;
  const insurable = price < R.insurablePriceBelowCents;
  const premiumRate = insurable
    ? insurancePremiumRatePercent(loanToValuePercent, input.amortizationYears)
    : 0;
  const premium = Math.round((loan * premiumRate) / 100);
  const premiumTaxPercent = R.premiumSalesTaxPercent[input.regionCode ?? ''] ?? 0;
  const mortgage = loan + premium;
  const paymentsPerYear = PAYMENTS_PER_YEAR[input.frequency];
  const rate = ratePerPayment(input.ratePercent, paymentsPerYear);
  const scheduled = input.amortizationYears * paymentsPerYear;
  const payment =
    input.frequency === 'acceleratedBiweekly'
      ? levelPayment(
          mortgage,
          ratePerPayment(input.ratePercent, 12),
          input.amortizationYears * 12,
        ) / 2
      : levelPayment(mortgage, rate, scheduled);
  const payments = mortgage ? paymentsToRepay(mortgage, rate, payment) : 0;
  return {
    minimumDownPaymentCents: minimum,
    belowMinimumDownPayment: down < minimum,
    loanToValuePercent,
    insurancePremiumRatePercent: premiumRate,
    insurancePremiumCents: premium,
    premiumSalesTaxCents: Math.round((premium * premiumTaxPercent) / 100),
    mortgageCents: mortgage,
    paymentCents: Math.round(payment),
    paymentsPerYear,
    yearsToPayOff: payments / paymentsPerYear,
    totalInterestCents: Math.max(0, Math.round(payment * payments - mortgage)),
  };
};
