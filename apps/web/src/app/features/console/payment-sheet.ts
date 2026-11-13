import { PaymentKind, PaymentMethod } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, OnInit, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PaymentUpdate } from '@homepact/shared';
import { localDay } from '../../shared/dates';
import { toCents } from '../../shared/money.pipe';
import { Sheet } from '../../shared/sheet';
import { PAYMENT_METHOD_LABEL } from '../../shared/status';

export type PaymentEntry = Omit<PaymentUpdate, 'allowDuplicate'>;

@Component({
  selector: 'hc-payment-sheet',
  imports: [FormsModule, Sheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payment-sheet.html',
})
export class PaymentSheet implements OnInit {
  protected readonly PaymentKind = PaymentKind;
  protected readonly methods = Object.values(PaymentMethod).map((id) => ({
    id,
    label: PAYMENT_METHOD_LABEL[id],
  }));
  readonly title = input.required<string>();
  readonly kind = input(PaymentKind.Payment);
  readonly initial = input<Partial<PaymentEntry>>({});
  readonly needsApproval = input(false);
  readonly busy = input(false);
  readonly submitted = output<PaymentEntry>();
  readonly closed = output<void>();

  protected readonly today = localDay();
  protected amount: number | null = null;
  protected receivedOn = this.today;
  protected method = PaymentMethod.Cheque;
  protected externalRef = '';
  protected note = '';

  ngOnInit(): void {
    const start = this.initial();
    if (start.amountCents) this.amount = start.amountCents / 100;
    if (start.receivedOn) this.receivedOn = start.receivedOn;
    if (start.method) this.method = start.method;
    this.externalRef = start.externalRef ?? '';
    this.note = start.note ?? '';
  }

  protected submit(): void {
    const amountCents = toCents(this.amount);
    if (amountCents <= 0 || !this.receivedOn) return;
    this.submitted.emit({
      amountCents,
      receivedOn: this.receivedOn,
      method: this.method,
      ...(this.externalRef.trim() && { externalRef: this.externalRef.trim() }),
      ...(this.note.trim() && { note: this.note.trim() }),
    });
  }
}
