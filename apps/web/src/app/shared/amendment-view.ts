import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Amendment } from '@homepact/shared';
import { isOpenAmendment } from '@homepact/shared/enums';
import { LocalDatePipe } from './dates';
import { ChangeLines } from './change-lines';
import { MoneyPipe } from './money.pipe';
import { AMENDMENT_BUYER_LABEL, AMENDMENT_LABEL, APPROVAL_REASON_LABEL } from './status';

/** A change order at a glance: what was asked, each change and its price, fees, credits and
 * instalments, the price before and after (tax included), and what it still waits for. */
@Component({
  selector: 'hc-amendment-view',
  imports: [ChangeLines, MoneyPipe, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './amendment-view.html',
  styleUrl: './amendment-view.scss',
})
export class AmendmentView {
  readonly amendment = input.required<Amendment>();
  readonly audience = input<'buyer' | 'company'>('company');

  protected readonly label = computed(
    () =>
      (this.audience() === 'buyer' ? AMENDMENT_BUYER_LABEL : AMENDMENT_LABEL)[
        this.amendment().status
      ],
  );
  protected readonly lines = computed(() => {
    const a = this.amendment();
    return a.changes.map((c) =>
      c.addedBySeller
        ? {
            ...c,
            label: $localize`:@@amendment.addedBySeller:${c.label}:label: (added by ${a.seller.name}:seller:)`,
          }
        : c,
    );
  });
  protected readonly reasons = computed(() =>
    (this.amendment().approval?.reasons ?? []).map((r) => APPROVAL_REASON_LABEL[r]).join(' · '),
  );
  protected readonly open = computed(() => isOpenAmendment(this.amendment().status));
  protected readonly change = computed(() => {
    const a = this.amendment();
    return a.after ? a.after.quote.totalCents - a.before.quote.totalCents : 0;
  });
}
