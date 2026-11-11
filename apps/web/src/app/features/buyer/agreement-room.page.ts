import { AgreementStatus, SignerStatus } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Agreement, AgreementPurchaser } from '@homepact/shared';
import { keyClauses } from '@homepact/shared/agreement-fields';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { AgreementDocument } from '../../shared/agreement-document';
import { LocalDatePipe } from '../../shared/dates';
import { downloadAgreement } from '../../shared/download';
import { Icon } from '../../shared/icon';
import { MoneyPipe } from '../../shared/money.pipe';
import { Sheet } from '../../shared/sheet';

/** A purchaser reads, initials and signs their agreement and keeps the PDF; only the purchaser
 * of the link can sign. */
@Component({
  selector: 'hc-agreement-room',
  imports: [FormsModule, RouterLink, MoneyPipe, LocalDatePipe, AgreementDocument, Sheet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement-room.page.html',
  styleUrl: './agreement-room.page.scss',
})
export class AgreementRoomPage {
  protected readonly AgreementStatus = AgreementStatus;
  protected readonly SignerStatus = SignerStatus;
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly paths = PATHS;
  readonly id = input.required<string>();

  protected readonly agreement = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.get<Agreement>(API.agreements.one(params)),
  });
  protected readonly a = computed(() =>
    this.agreement.hasValue() ? this.agreement.value() : undefined,
  );
  protected readonly me = computed((): AgreementPurchaser | undefined => {
    const a = this.a();
    return a?.purchasers.find((p) => p.id === a.viewerPurchaserId);
  });
  protected readonly canSign = computed(
    () =>
      this.a()?.status === AgreementStatus.UnderReview &&
      !!this.me() &&
      this.me()?.status !== SignerStatus.Signed,
  );
  protected readonly keyClauses = computed(() => keyClauses(this.a()?.sections ?? []));
  protected readonly initials = signal<number[]>([]);
  protected readonly allInitialled = computed(() =>
    this.keyClauses().every((c) => this.initials().includes(c)),
  );
  protected readonly others = computed(() =>
    (this.a()?.purchasers ?? []).filter((p) => p.id !== this.a()?.viewerPurchaserId),
  );

  protected readonly signing = signal(false);
  protected readonly busy = signal(false);
  protected readonly downloading = signal(false);
  protected fullName = '';
  protected agree = false;

  constructor() {
    effect(() => this.sendStaffToTheConsole());
  }

  private sendStaffToTheConsole(): void {
    if (this.a() && this.auth.isStaff()) {
      void this.router.navigate(PATHS.console.agreement(this.id()), { replaceUrl: true });
    }
  }

  protected toggleInitial(clause: number): void {
    this.initials.update((list) =>
      list.includes(clause) ? list.filter((c) => c !== clause) : [...list, clause],
    );
  }

  protected openSign(): void {
    this.fullName = this.me()?.name ?? '';
    this.agree = false;
    this.signing.set(true);
  }

  protected async sign(a: Agreement): Promise<void> {
    if (this.busy() || !this.agree) return;
    this.busy.set(true);
    try {
      this.agreement.set(
        await this.api.post<Agreement>(API.agreements.sign(a.id), {
          contentHash: a.contentHash,
          fullName: this.fullName.trim(),
          initials: this.initials(),
          agree: true,
        }),
      );
      this.signing.set(false);
      this.toast.success($localize`:@@agreementRoom.signed:Thank you — your signature is on file.`);
    } catch (err) {
      this.toast.error(err);
      this.agreement.reload();
    } finally {
      this.busy.set(false);
    }
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
}
