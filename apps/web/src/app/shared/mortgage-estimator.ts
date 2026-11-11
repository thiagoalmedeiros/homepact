import { DecimalPipe, PercentPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Currency } from '@homepact/shared/format';
import {
  CANADIAN_MORTGAGE_RULES,
  estimateMortgage,
  PAYMENT_FREQUENCIES,
  type MortgageReferenceRate,
  type PaymentFrequency,
} from '@homepact/shared/mortgage';
import { API } from '../core/api-endpoints';
import { ApiService } from '../core/api.service';
import { LocalDatePipe } from './dates';
import { MoneyPipe } from './money.pipe';

const FALLBACK_RATE_PERCENT = 5;
const SPARK = { width: 120, height: 32, pad: 3 };

/** What a buyer would pay each period for this home: mortgage insurance, payment and interest.
 * Runs in the browser; only the reference rate is fetched. An estimate, not a financing offer. */
@Component({
  selector: 'hc-mortgage-estimator',
  imports: [FormsModule, MoneyPipe, PercentPipe, DecimalPipe, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mortgage-estimator.html',
  styleUrl: './mortgage-estimator.scss',
})
export class MortgageEstimator {
  private readonly api = inject(ApiService);
  readonly priceCents = input.required<number>();
  readonly currency = input<Currency>('CAD');
  readonly regionCode = input<string | undefined>(undefined);

  protected readonly frequencies = PAYMENT_FREQUENCIES;
  protected readonly amortizations = [15, 20, 25, CANADIAN_MORTGAGE_RULES.maxAmortizationYears];
  protected readonly frequencyLabel: Record<PaymentFrequency, string> = {
    monthly: $localize`:@@mortgage.frequency.monthly:Monthly`,
    biweekly: $localize`:@@mortgage.frequency.biweekly:Every two weeks`,
    acceleratedBiweekly: $localize`:@@mortgage.frequency.acceleratedBiweekly:Every two weeks, accelerated`,
    weekly: $localize`:@@mortgage.frequency.weekly:Weekly`,
  };
  protected readonly perPayment: Record<PaymentFrequency, string> = {
    monthly: $localize`:@@mortgage.per.monthly:per month`,
    biweekly: $localize`:@@mortgage.per.biweekly:every two weeks`,
    acceleratedBiweekly: $localize`:@@mortgage.per.acceleratedBiweekly:every two weeks`,
    weekly: $localize`:@@mortgage.per.weekly:per week`,
  };

  protected readonly reference = resource({
    loader: () => this.api.get<MortgageReferenceRate | null>(API.marketRates.mortgage),
  });
  protected readonly referenceRate = computed(() =>
    this.reference.hasValue() ? this.reference.value() : null,
  );

  protected readonly downPercent = signal(20);
  protected readonly ratePercent = signal(FALLBACK_RATE_PERCENT);
  protected readonly amortizationYears = signal(25);
  protected readonly frequency = signal<PaymentFrequency>('monthly');
  private rateTouched = false;

  protected readonly downPaymentCents = computed(() =>
    Math.round((this.priceCents() * this.downPercent()) / 100),
  );
  protected readonly estimate = computed(() =>
    estimateMortgage({
      priceCents: this.priceCents(),
      downPaymentCents: this.downPaymentCents(),
      ratePercent: this.ratePercent(),
      amortizationYears: this.amortizationYears(),
      frequency: this.frequency(),
      regionCode: this.regionCode(),
    }),
  );
  protected readonly minimumDownPercent = computed(() =>
    this.priceCents() ? (this.estimate().minimumDownPaymentCents / this.priceCents()) * 100 : 0,
  );
  protected readonly sparkline = computed(() => {
    const history = this.referenceRate()?.history ?? [];
    if (history.length < 2) return null;
    const rates = history.map((h) => h.ratePercent);
    const low = Math.min(...rates);
    const span = Math.max(...rates) - low || 1;
    const step = (SPARK.width - 2 * SPARK.pad) / (history.length - 1);
    const y = (rate: number) =>
      SPARK.pad + (1 - (rate - low) / span) * (SPARK.height - 2 * SPARK.pad);
    return {
      points: rates.map((r, i) => `${(SPARK.pad + i * step).toFixed(1)},${y(r).toFixed(1)}`),
      first: rates[0]!,
      last: rates[rates.length - 1]!,
    };
  });
  protected readonly spark = SPARK;

  constructor() {
    effect(() => this.startAtReferenceRate());
  }

  private startAtReferenceRate(): void {
    const reference = this.referenceRate();
    untracked(() => {
      if (reference && !this.rateTouched) this.ratePercent.set(reference.ratePercent);
    });
  }

  protected setRate(value: number | null): void {
    this.rateTouched = true;
    this.ratePercent.set(Math.min(Math.max(Number(value) || 0, 0), 25));
  }

  protected useReferenceRate(): void {
    const reference = this.referenceRate();
    if (!reference) return;
    this.rateTouched = false;
    this.ratePercent.set(reference.ratePercent);
  }

  protected setDownPercent(value: number | null): void {
    this.downPercent.set(Math.min(Math.max(Number(value) || 0, 0), 100));
  }

  protected sparkLabel(first: number, last: number): string {
    return $localize`:@@mortgage.sparkLabel:Posted 5-year rate over the last 12 months, from ${first}:from:% to ${last}:to:%`;
  }
}
