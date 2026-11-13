import {
  AgreementStatus,
  isPayableAgreement,
  isRefundableAgreement,
  PaymentKind,
  PaymentStatus,
} from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import type { Agreement, AgreementLedger, AgreementPayment } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { LocalDatePipe } from '../../shared/dates';
import { Icon } from '../../shared/icon';
import { MoneyPipe } from '../../shared/money.pipe';
import { ReasonSheet } from '../../shared/reason-sheet';
import { INSTALMENT_LABEL, PAYMENT_LABEL, PAYMENT_METHOD_LABEL } from '../../shared/status';
import { PaymentActions, REASON_TEXT } from './payment-actions';
import { PaymentSheet, type PaymentEntry } from './payment-sheet';

type Form = { mode: 'record' | 'refund' } | { mode: 'edit' | 'reenter'; entry: AgreementPayment };
type Reason = { mode: 'void' | 'reject'; entry: AgreementPayment };

@Component({
  selector: 'hc-agreement-payments',
  imports: [MoneyPipe, LocalDatePipe, Icon, PaymentSheet, ReasonSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement-payments.html',
  styleUrl: './agreement-payments.scss',
})
export class AgreementPayments {
  protected readonly AgreementStatus = AgreementStatus;
  protected readonly PaymentKind = PaymentKind;
  protected readonly PaymentStatus = PaymentStatus;
  protected readonly LINE = INSTALMENT_LABEL;
  protected readonly STATUS = PAYMENT_LABEL;
  protected readonly METHOD = PAYMENT_METHOD_LABEL;
  protected readonly titles = {
    record: $localize`:@@payments.recordTitle:Record a payment`,
    refund: $localize`:@@payments.refundTitle:Record a refund`,
    edit: $localize`:@@payments.editTitle:Fix this payment`,
    reenter: $localize`:@@payments.reenterTitle:Record the right payment`,
  };
  protected readonly reasons = REASON_TEXT;

  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly actions = inject(PaymentActions);
  readonly agreement = input.required<Agreement>();

  protected readonly ledger = resource({
    params: () => {
      const a = this.agreement();
      return isRefundableAgreement(a.status) ? { id: a.id, status: a.status } : undefined;
    },
    loader: ({ params }) => this.api.get<AgreementLedger>(API.payments.ledger(params.id)),
  });
  protected readonly l = computed(() => (this.ledger.hasValue() ? this.ledger.value() : undefined));
  protected readonly payable = computed(() => isPayableAgreement(this.agreement().status));
  protected readonly held = computed(() => this.l()?.schedule.totals.netPaidCents ?? 0);
  protected readonly shown = computed(() => !!this.l() && (this.payable() || this.held() > 0));
  protected readonly canRefund = computed(
    () =>
      this.auth.managesPayments() &&
      isRefundableAgreement(this.agreement().status) &&
      this.held() > 0,
  );
  protected readonly form = signal<Form | null>(null);
  protected readonly asking = signal<Reason | null>(null);

  /** A voided entry is re-entered by finance; a rejected one by whoever recorded it, or finance. */
  protected canReenter(p: AgreementPayment): boolean {
    if (p.replacedById || p.kind !== PaymentKind.Payment || !this.payable()) return false;
    if (p.status === PaymentStatus.Voided) return this.auth.managesPayments();
    return (
      p.status === PaymentStatus.Rejected && (this.actions.isMine(p) || this.auth.managesPayments())
    );
  }

  protected initialOf(form: Form): Partial<PaymentEntry> {
    if (!('entry' in form)) return {};
    const { amountCents, receivedOn, method, externalRef, note } = form.entry;
    return { amountCents, receivedOn, method, externalRef, note };
  }

  protected async save(form: Form, entry: PaymentEntry): Promise<void> {
    const ok =
      form.mode === 'edit'
        ? await this.actions.update(form.entry, entry)
        : await this.actions.record(this.agreement().id, {
            kind: form.mode === 'refund' ? PaymentKind.Refund : PaymentKind.Payment,
            ...entry,
            ...(form.mode === 'reenter' && { replacesId: form.entry.id }),
          });
    if (ok) this.done();
  }

  protected async approve(p: AgreementPayment): Promise<void> {
    if (await this.actions.approve(p)) this.done();
  }

  protected async withdraw(p: AgreementPayment): Promise<void> {
    if (await this.actions.withdraw(p)) this.done();
  }

  protected async explain(ask: Reason, reason: string): Promise<void> {
    const ok =
      ask.mode === 'void'
        ? await this.actions.void(ask.entry, reason)
        : await this.actions.reject(ask.entry, reason);
    if (ok) this.done();
  }

  private done(): void {
    this.form.set(null);
    this.asking.set(null);
    this.ledger.reload();
  }
}
