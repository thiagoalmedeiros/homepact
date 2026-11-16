import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PriceChange } from '@homepact/shared';
import type { Currency } from '@homepact/shared/format';
import { LocalDatePipe } from './dates';
import { MoneyPipe } from './money.pipe';

/** How executed change orders moved an agreement's price, from what was signed to now. */
@Component({
  selector: 'hc-price-changes',
  imports: [MoneyPipe, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './price-changes.html',
  styleUrl: './price-changes.scss',
})
export class PriceChanges {
  readonly changes = input<PriceChange[] | undefined>(undefined);
  readonly currency = input<Currency>('CAD');
}
