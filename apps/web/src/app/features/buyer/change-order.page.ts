import { AmendmentStatus, SignerStatus } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Amendment } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { ToastService } from '../../core/toast.service';
import { AmendmentView } from '../../shared/amendment-view';
import { LocalDatePipe } from '../../shared/dates';
import { downloadAmendment } from '../../shared/download';
import { Icon } from '../../shared/icon';
import { MoneyPipe } from '../../shared/money.pipe';
import { Sheet } from '../../shared/sheet';

/** A change order opened with a purchaser's signing link: read what changes and at what price,
 * sign exactly that, and keep the PDF once it is executed. */
@Component({
  selector: 'hc-change-order',
  imports: [FormsModule, RouterLink, AmendmentView, LocalDatePipe, MoneyPipe, Sheet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './change-order.page.html',
})
export class ChangeOrderPage {
  protected readonly AmendmentStatus = AmendmentStatus;
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly paths = PATHS;
  readonly id = input.required<string>();

  protected readonly order = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.get<Amendment>(API.amendments.byId(params)),
  });
  protected readonly o = computed(() => (this.order.hasValue() ? this.order.value() : undefined));
  protected readonly me = computed(() => {
    const o = this.o();
    return o?.purchasers.find((p) => p.id === o.viewerPurchaserId);
  });
  protected readonly canSign = computed(
    () =>
      this.o()?.status === AmendmentStatus.UnderReview &&
      !!this.me() &&
      this.me()?.status !== SignerStatus.Signed,
  );
  protected readonly signed = computed(() => this.me()?.status === SignerStatus.Signed);

  protected readonly signing = signal(false);
  protected readonly busy = signal(false);
  protected readonly downloading = signal(false);
  protected fullName = '';
  protected agree = false;

  protected openSign(): void {
    this.fullName = this.me()?.name ?? '';
    this.agree = false;
    this.signing.set(true);
  }

  protected async sign(o: Amendment): Promise<void> {
    if (this.busy() || !this.agree || !o.contentHash) return;
    this.busy.set(true);
    try {
      this.order.set(
        await this.api.post<Amendment>(API.amendments.sign(o.agreementId, o.id), {
          contentHash: o.contentHash,
          fullName: this.fullName.trim(),
          agree: true,
        }),
      );
      this.signing.set(false);
      this.toast.success($localize`:@@changeOrder.signed:Thank you — your signature is on file.`);
    } catch (err) {
      this.toast.error(err);
      this.order.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async download(o: Amendment): Promise<void> {
    this.downloading.set(true);
    try {
      await downloadAmendment(this.api, o);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.downloading.set(false);
    }
  }
}
