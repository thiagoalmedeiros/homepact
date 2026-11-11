import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { TaxComponent } from '@homepact/shared';
import { Icon } from './icon';

export interface TaxComponentDraft {
  label: string;
  ratePercent: number | null;
}

/** The API stores rates in thousandths of a percent: 9.975 is fine, 9.9751 is not. */
const hasAtMostThreeDecimals = (rate: number) =>
  Math.abs(rate * 1000 - Math.round(rate * 1000)) < 1e-6;

/** A province needs at least one tax with a label and a rate between 0 and 100. */
export const validComponents = (rows: TaxComponentDraft[]): boolean =>
  rows.length > 0 &&
  rows.every(
    (r) =>
      r.label.trim() &&
      r.ratePercent !== null &&
      r.ratePercent >= 0 &&
      r.ratePercent <= 100 &&
      hasAtMostThreeDecimals(r.ratePercent),
  );

export const toComponents = (rows: TaxComponentDraft[]): TaxComponent[] =>
  rows.map((r) => ({ label: r.label.trim(), ratePercent: r.ratePercent ?? 0 }));

/** The taxes of one province, e.g. GST 5% and QST 9.975%. */
@Component({
  selector: 'hc-tax-components-editor',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tax-components-editor.html',
  styleUrl: './tax-components-editor.scss',
})
export class TaxComponentsEditor {
  readonly components = model.required<TaxComponentDraft[]>();

  protected add(): void {
    this.components.update((rows) => [...rows, { label: '', ratePercent: null }]);
  }

  protected remove(i: number): void {
    this.components.update((rows) => rows.filter((_, j) => j !== i));
  }

  protected set(i: number, patch: Partial<TaxComponentDraft>): void {
    this.components.update((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
}
