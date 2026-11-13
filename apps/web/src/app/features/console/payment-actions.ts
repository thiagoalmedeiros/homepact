import { PaymentStatus } from '@homepact/shared/enums';
import { Injectable, inject, signal } from '@angular/core';
import type { AgreementPayment, PaymentCreate, PaymentUpdate } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiRequestError, ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';

type Entry = Pick<AgreementPayment, 'id' | 'agreementId' | 'reference'>;

export const REASON_TEXT = {
  void: {
    title: $localize`:@@payments.void.title:Void this payment?`,
    message: $localize`:@@payments.void.message:It stays on the ledger as voided, with your reason, and stops counting. You can then record the right one.`,
    confirm: $localize`:@@payments.void.confirm:Void payment`,
  },
  reject: {
    title: $localize`:@@payments.reject.title:Reject this payment?`,
    message: $localize`:@@payments.reject.message:Whoever recorded it sees your reason and can record it again.`,
    confirm: $localize`:@@payments.reject.confirm:Reject payment`,
  },
};

const duplicateOf = (err: unknown): string | undefined =>
  err instanceof ApiRequestError ? err.details?.['duplicateOf']?.[0] : undefined;

@Injectable({ providedIn: 'root' })
export class PaymentActions {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly auth = inject(AuthService);
  readonly busy = signal(false);

  isMine(p: AgreementPayment): boolean {
    return p.recordedBy.id === this.auth.user()?.id;
  }

  /** Finance or an administrator approves or rejects what someone else recorded. */
  canReview(p: AgreementPayment): boolean {
    return p.status === PaymentStatus.Pending && this.auth.managesPayments() && !this.isMine(p);
  }

  canChange(p: AgreementPayment): boolean {
    return p.status === PaymentStatus.Pending && this.isMine(p);
  }

  canVoid(p: AgreementPayment): boolean {
    return p.status === PaymentStatus.Posted && this.auth.managesPayments();
  }

  record(agreementId: string, entry: PaymentCreate): Promise<boolean> {
    return this.saveOnce(
      (allowDuplicate) =>
        this.api.post(API.payments.ledger(agreementId), {
          ...entry,
          ...(allowDuplicate && { allowDuplicate }),
        }),
      $localize`:@@payments.toasts.recorded:Payment recorded`,
    );
  }

  update(entry: Entry, changes: PaymentUpdate): Promise<boolean> {
    return this.saveOnce(
      (allowDuplicate) =>
        this.api.put(API.payments.one(entry.agreementId, entry.id), {
          ...changes,
          ...(allowDuplicate && { allowDuplicate }),
        }),
      $localize`:@@payments.toasts.updated:Payment updated`,
    );
  }

  approve(entry: Entry): Promise<boolean> {
    return this.run(
      () => this.api.post(API.payments.approve(entry.agreementId, entry.id), {}),
      $localize`:@@payments.toasts.approved:${entry.reference}:reference: approved; it now counts`,
    );
  }

  reject(entry: Entry, reason: string): Promise<boolean> {
    return this.run(
      () => this.api.post(API.payments.reject(entry.agreementId, entry.id), { reason }),
      $localize`:@@payments.toasts.rejected:${entry.reference}:reference: rejected`,
    );
  }

  void(entry: Entry, reason: string): Promise<boolean> {
    return this.run(
      () => this.api.post(API.payments.void(entry.agreementId, entry.id), { reason }),
      $localize`:@@payments.toasts.voided:${entry.reference}:reference: voided`,
    );
  }

  async withdraw(entry: Entry): Promise<boolean> {
    const ok = await this.confirm.ask({
      title: $localize`:@@payments.confirmWithdraw.title:Take back ${entry.reference}:reference:?`,
      message: $localize`:@@payments.confirmWithdraw.message:It stays on the ledger as withdrawn and will never count.`,
      confirmLabel: $localize`:@@payments.confirmWithdraw.confirm:Take it back`,
      destructive: true,
    });
    if (!ok) return false;
    return this.run(
      () => this.api.post(API.payments.withdraw(entry.agreementId, entry.id), {}),
      $localize`:@@payments.toasts.withdrawn:${entry.reference}:reference: withdrawn`,
    );
  }

  /** Saves, and when the server finds the same entry already recorded, asks before saving again. */
  private async saveOnce(
    save: (allowDuplicate: boolean) => Promise<unknown>,
    success: string,
  ): Promise<boolean> {
    let twin: string | undefined;
    const saved = await this.run(
      () => save(false),
      success,
      (err) => (twin = duplicateOf(err)),
    );
    if (saved || !twin) return saved;
    const ok = await this.confirm.ask({
      title: $localize`:@@payments.confirmDuplicate.title:Already recorded?`,
      message: $localize`:@@payments.confirmDuplicate.message:${twin}:reference: has the same amount, date and reference. Record this one as well?`,
      confirmLabel: $localize`:@@payments.confirmDuplicate.confirm:Record it anyway`,
    });
    return ok && this.run(() => save(true), success);
  }

  /** One request at a time; a failure the caller does not claim becomes an error toast. */
  private async run(
    request: () => Promise<unknown>,
    success: string,
    claims: (err: unknown) => unknown = () => false,
  ): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    try {
      await request();
      this.toast.success(success);
      return true;
    } catch (err) {
      if (!claims(err)) this.toast.error(err);
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
