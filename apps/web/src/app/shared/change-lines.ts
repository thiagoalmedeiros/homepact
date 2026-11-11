import { ChangeDecision } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { RequestedChange } from '@homepact/shared';
import type { Currency } from '@homepact/shared/format';
import { Icon } from './icon';
import { MoneyPipe } from './money.pipe';

/** The requested change lines with their price impact and, once answered, the decision. */
@Component({
  selector: 'hc-change-lines',
  imports: [MoneyPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './change-lines.html',
  styleUrl: './change-lines.scss',
})
export class ChangeLines {
  readonly changes =
    input.required<Pick<RequestedChange, 'label' | 'deltaCents' | 'decision' | 'decisionNote'>[]>();
  readonly currency = input<Currency>('CAD');
  protected readonly ChangeDecision = ChangeDecision;
}
