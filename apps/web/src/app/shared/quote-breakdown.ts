import { PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { QuoteSnapshot } from '@homepact/shared';
import { MoneyPipe } from './money.pipe';

/** Itemised quote: options, adjustments, referral credit, price before tax, sales tax and total. */
@Component({
  selector: 'hc-quote-breakdown',
  imports: [MoneyPipe, PercentPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-breakdown.html',
  styleUrl: './quote-breakdown.scss',
})
export class QuoteBreakdown {
  readonly quote = input.required<QuoteSnapshot>();
  protected readonly groups = computed(() => {
    const map = new Map<string, QuoteSnapshot['lines']>();
    for (const line of this.quote().lines) {
      map.set(line.areaLabel, [...(map.get(line.areaLabel) ?? []), line]);
    }
    return [...map].map(([label, lines]) => ({ label, lines }));
  });
}
