import { AgreementStatus, isOpenAgreement, SignerStatus } from '@homepact/shared/enums';
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
import type {
  Agreement,
  AgreementIssued,
  AgreementUpdate,
  SignerInvitation,
} from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { TenantService } from '../../core/tenant.service';
import { ToastService } from '../../core/toast.service';
import { AgreementDocument } from '../../shared/agreement-document';
import { copyText } from '../../shared/copy';
import { LocalDatePipe } from '../../shared/dates';
import { downloadAgreement } from '../../shared/download';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { Sheet } from '../../shared/sheet';
import { AGREEMENT_LABEL } from '../../shared/status';
import { AgreementPayments } from './agreement-payments';
import { AgreementTermsSheet } from './agreement-terms-sheet';

interface Handout extends SignerInvitation {
  link: string;
}

/** The seller's agreement page: review, send for signature, hand out links and codes,
 * countersign. */
@Component({
  selector: 'hc-console-agreement',
  imports: [
    FormsModule,
    RouterLink,
    LoadState,
    RelativeTimePipe,
    AgreementDocument,
    AgreementTermsSheet,
    AgreementPayments,
    Sheet,
    Icon,
    LocalDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement.page.html',
  styleUrl: './agreement.page.scss',
})
export class AgreementPage {
  protected readonly AgreementStatus = AgreementStatus;
  protected readonly SignerStatus = SignerStatus;
  protected readonly discardTitle = $localize`:@@console.agreement.discardTitle:Discard this draft?`;
  protected readonly cancelTitle = $localize`:@@console.agreement.cancelTitle:Cancel this agreement?`;
  protected readonly copyLabel = $localize`:@@console.agreement.copyLink:Copy link and code`;
  protected readonly editDraftTitle = $localize`:@@console.terms.editTitle:Edit the draft`;
  protected readonly amendTitle = $localize`:@@console.terms.amendTitle:Change the agreement`;

  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly paths = PATHS;
  readonly id = input.required<string>();
  protected readonly LABEL = AGREEMENT_LABEL;

  protected readonly agreement = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.get<Agreement>(API.agreements.one(params)),
  });
  protected readonly a = computed(() =>
    this.agreement.hasValue() ? this.agreement.value() : undefined,
  );
  protected readonly busy = signal(false);
  protected readonly downloading = signal(false);
  protected readonly editing = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly countersigning = signal(false);
  protected readonly handouts = signal<Handout[]>([]);
  protected cancelReason = '';
  protected counterName = '';
  protected counterAgree = false;

  protected readonly terms = computed((): AgreementUpdate => {
    const a = this.a();
    if (!a) return { templateId: '', purchasers: [], deposits: [], conditions: [] };
    return {
      templateId: a.template.id,
      purchasers: a.purchasers.map((p) => ({
        name: p.name,
        ...(p.email && { email: p.email }),
        ...(p.phone && { phone: p.phone }),
      })),
      deposits: a.terms.deposits,
      conditions: a.terms.conditions,
      ...(a.terms.closingDate && { closingDate: a.terms.closingDate }),
      ...(a.terms.specialTerms && { specialTerms: a.terms.specialTerms }),
    };
  });

  protected readonly open = computed(() => {
    const status = this.a()?.status;
    return !!status && isOpenAgreement(status) && this.auth.isStaff();
  });

  protected readonly signedCount = computed(
    () => this.a()?.purchasers.filter((p) => p.status === SignerStatus.Signed).length ?? 0,
  );

  protected async update(terms: AgreementUpdate): Promise<void> {
    const a = this.a();
    const signed = this.signedCount();
    if (a?.issuedAt && signed > 0) {
      const ok = await this.confirm.ask({
        title: $localize`:@@console.agreement.confirmAmend.title:Change an agreement that is already signed?`,
        message: $localize`:@@console.agreement.confirmAmend.message:${signed}:count: signature(s) given so far will no longer be valid, and those purchasers have to read and sign the new text.`,
        confirmLabel: $localize`:@@console.agreement.confirmAmend.confirm:Change it anyway`,
        destructive: true,
      });
      if (!ok) return;
    }
    if (
      await this.run(
        () => this.api.put<Agreement>(API.agreements.one(this.id()), terms),
        $localize`:@@console.agreement.toasts.updated:Agreement updated`,
      )
    ) {
      this.editing.set(false);
    }
  }

  protected async issue(a: Agreement): Promise<void> {
    const company =
      this.tenant.company()?.name ?? $localize`:@@console.agreement.yourCompany:your company`;
    const ok = await this.confirm.ask({
      title: $localize`:@@console.agreement.confirmSend.title:Send this agreement for signature?`,
      message: $localize`:@@console.agreement.confirmSend.message:Each purchaser gets their own link and code to sign it on behalf of ${company}:company:. You will countersign once they all have.`,
      confirmLabel: $localize`:@@console.agreement.confirmSend.confirm:Send for signature`,
    });
    if (!ok) return;
    const issued = await this.act(() =>
      this.api.post<AgreementIssued>(API.agreements.issue(a.id), { contentHash: a.contentHash }),
    );
    if (!issued) return;
    this.agreement.set(issued.agreement);
    this.handouts.set(issued.invitations.map((i) => this.handout(i)));
    this.toast.success(
      $localize`:@@console.agreement.toasts.sent:Sent for signature to ${issued.invitations.length}:count: purchaser(s)`,
    );
  }

  /** A fresh link and code for one purchaser, when the first one never arrived. */
  protected async reinvite(purchaserId: string): Promise<void> {
    const invitation = await this.act(() =>
      this.api.post<SignerInvitation>(API.agreements.invite(this.id(), purchaserId), {}),
    );
    if (!invitation) return;
    this.handouts.set([this.handout(invitation)]);
    this.toast.success($localize`:@@console.agreement.toasts.reinvited:New link and code ready`);
  }

  protected async countersign(a: Agreement): Promise<void> {
    if (!this.counterAgree) return;
    if (
      await this.run(
        () =>
          this.api.post<Agreement>(API.agreements.countersign(a.id), {
            contentHash: a.contentHash,
            fullName: this.counterName.trim(),
            agree: true,
          }),
        $localize`:@@console.agreement.toasts.executed:Agreement executed`,
      )
    ) {
      this.countersigning.set(false);
      this.counterAgree = false;
    }
  }

  protected openCountersign(): void {
    this.counterName = this.auth.user()?.name ?? '';
    this.counterAgree = false;
    this.countersigning.set(true);
  }

  protected async cancel(): Promise<void> {
    const reason = this.cancelReason.trim();
    const ok = await this.run(
      () => this.api.post<Agreement>(API.agreements.cancel(this.id()), reason ? { reason } : {}),
      $localize`:@@console.agreement.toasts.cancelled:Agreement cancelled`,
    );
    if (ok) {
      this.cancelling.set(false);
      this.cancelReason = '';
    }
  }

  protected async copy(h: Handout): Promise<void> {
    const text = $localize`:@@console.agreement.handoutText:${h.link}:link: — code ${h.code}:code:`;
    this.toast.show(
      (await copyText(text)) ? $localize`:@@console.agreement.copied:Link and code copied` : text,
    );
  }

  protected async download(a: Agreement): Promise<void> {
    this.downloading.set(true);
    try {
      await downloadAgreement(this.api, a);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.downloading.set(false);
    }
  }

  private handout(invitation: SignerInvitation): Handout {
    return {
      ...invitation,
      link: `${location.origin}${PATHS.invite}?key=${encodeURIComponent(invitation.key)}`,
    };
  }

  /** One request at a time; a failure is shown and the agreement reloaded. */
  private async act<T>(request: () => Promise<T>): Promise<T | undefined> {
    if (this.busy()) return undefined;
    this.busy.set(true);
    try {
      return await request();
    } catch (err) {
      this.toast.error(err);
      this.agreement.reload();
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  /** Saves a change to the agreement, then shows it. */
  private async run(request: () => Promise<Agreement>, success: string): Promise<boolean> {
    const a = await this.act(request);
    if (!a) return false;
    this.agreement.set(a);
    this.toast.success(success);
    return true;
  }
}
