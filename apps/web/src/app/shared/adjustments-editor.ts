import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Adjustment } from '@homepact/shared';
import { Icon } from './icon';
import { toCents } from './money.pipe';

/** Price lines the seller adds on top of the configuration: lot premiums, promotions, credits. */
@Component({
  selector: 'hc-adjustments-editor',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './adjustments-editor.html',
  styleUrl: './adjustments-editor.scss',
})
export class AdjustmentsEditor {
  readonly adjustments = model.required<Adjustment[]>();
  protected readonly toCents = toCents;

  protected add(): void {
    this.adjustments.update((a) => [...a, { label: '', amountCents: 0 }]);
  }

  protected remove(i: number): void {
    this.adjustments.update((a) => a.filter((_, j) => j !== i));
  }

  protected set(i: number, patch: Partial<Adjustment>): void {
    this.adjustments.update((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
}

/** Drops blank rows before sending. */
export const cleanAdjustments = (list: Adjustment[]): Adjustment[] =>
  list
    .filter((a) => a.label.trim() && a.amountCents !== 0)
    .map((a) => ({ ...a, label: a.label.trim() }));
