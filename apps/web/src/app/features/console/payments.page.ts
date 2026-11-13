import { PaymentStatus } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AgreementPayment } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { LocalDatePipe } from '../../shared/dates';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { ReasonSheet } from '../../shared/reason-sheet';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PAYMENT_LABEL, PAYMENT_METHOD_LABEL } from '../../shared/status';
import { PaymentActions, REASON_TEXT } from './payment-actions';

type Filter = PaymentStatus.Pending | PaymentStatus.Rejected | PaymentStatus.Voided;

@Component({
  selector: 'hc-console-payments',
  imports: [RouterLink, LoadState, MoneyPipe, LocalDatePipe, RelativeTimePipe, ReasonSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payments.page.html',
  styleUrl: './payments.page.scss',
})
export class PaymentsPage {
  protected readonly PaymentStatus = PaymentStatus;
  protected readonly STATUS = PAYMENT_LABEL;
  protected readonly METHOD = PAYMENT_METHOD_LABEL;
  protected readonly paths = PATHS;
  protected readonly rejectText = REASON_TEXT.reject;
  protected readonly filters: { id: Filter; label: string }[] = [
    {
      id: PaymentStatus.Pending,
      label: $localize`:@@console.payments.filters.pending:Waiting for approval`,
    },
    { id: PaymentStatus.Rejected, label: $localize`:@@console.payments.filters.rejected:Rejected` },
    { id: PaymentStatus.Voided, label: $localize`:@@console.payments.filters.voided:Voided` },
  ];

  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly actions = inject(PaymentActions);
  protected readonly filter = signal<Filter>(PaymentStatus.Pending);
  protected readonly entries = resource({
    params: () => this.filter(),
    loader: ({ params }) =>
      this.api.get<AgreementPayment[]>(API.payments.queue, { status: params }),
  });
  protected readonly list = computed(() => (this.entries.hasValue() ? this.entries.value() : []));
  protected readonly rejecting = signal<AgreementPayment | null>(null);

  protected async approve(p: AgreementPayment): Promise<void> {
    if (await this.actions.approve(p)) this.entries.reload();
  }

  protected async reject(p: AgreementPayment, reason: string): Promise<void> {
    if (!(await this.actions.reject(p, reason))) return;
    this.rejecting.set(null);
    this.entries.reload();
  }
}
