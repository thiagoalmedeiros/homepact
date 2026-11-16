import {
  AgreementStatus,
  AmendmentStatus,
  isRefundableAgreement,
  isUnsignedAmendment,
  PaymentKind,
  SignerStatus,
} from '@homepact/shared/enums';
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
import type {
  Agreement,
  AgreementCurrent,
  AgreementPurchaser,
  Amendment,
  AmendmentPreview,
  BuyerLedger,
  BuyerPayment,
  HouseDetail,
  Selections,
} from '@homepact/shared';
import { keyClauses } from '@homepact/shared/agreement-fields';
import { agreementState } from '@homepact/shared/agreement-state';
import { diffSelections } from '@homepact/shared/changes';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../core/confirm.service';
import { AgreementDocument } from '../../shared/agreement-document';
import { AmendmentView } from '../../shared/amendment-view';
import { ChangeLines } from '../../shared/change-lines';
import { livePrice } from '../../shared/live-price';
import { PriceChanges } from '../../shared/price-changes';
import { SelectionEditor } from '../../shared/selection-editor';
import { LocalDatePipe } from '../../shared/dates';
import { downloadAgreement, downloadAmendment, downloadReceipt } from '../../shared/download';
import { Icon } from '../../shared/icon';
import { MoneyPipe } from '../../shared/money.pipe';
import { Sheet } from '../../shared/sheet';
import { INSTALMENT_LABEL, PAYMENT_METHOD_LABEL } from '../../shared/status';

/** A purchaser reads, initials and signs their agreement and keeps the PDF; only the purchaser
 * of the link can sign. Once it is executed, the buyer asks for change orders here. */
@Component({
  selector: 'hc-agreement-room',
  imports: [
    FormsModule,
    RouterLink,
    MoneyPipe,
    LocalDatePipe,
    AgreementDocument,
    AmendmentView,
    ChangeLines,
    SelectionEditor,
    PriceChanges,
    Sheet,
    Icon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement-room.page.html',
  styleUrl: './agreement-room.page.scss',
})
export class AgreementRoomPage {
  protected readonly AgreementStatus = AgreementStatus;
  protected readonly AmendmentStatus = AmendmentStatus;
  protected readonly SignerStatus = SignerStatus;
  protected readonly PaymentKind = PaymentKind;
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly paths = PATHS;
  readonly id = input.required<string>();

  protected readonly agreement = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.get<Agreement>(API.agreements.one(params)),
  });
  protected readonly a = computed(() =>
    this.agreement.hasValue() ? this.agreement.value() : undefined,
  );
  /** Change orders are the buyer's once the agreement is executed (not a signing link's). */
  private readonly ordersOf = computed(() => {
    const a = this.a();
    return a?.status === AgreementStatus.Executed && !a.viewerPurchaserId ? a.id : undefined;
  });
  protected readonly orders = resource({
    params: () => this.ordersOf(),
    loader: ({ params }) => this.api.get<Amendment[]>(API.amendments.list(params)),
  });
  protected readonly standing = resource({
    params: () => this.ordersOf(),
    loader: ({ params }) => this.api.get<AgreementCurrent>(API.amendments.current(params)),
  });
  protected readonly changeOrders = computed(() =>
    this.orders.hasValue() ? [...this.orders.value()].reverse() : [],
  );
  protected readonly now = computed(() =>
    this.standing.hasValue() ? this.standing.value() : undefined,
  );
  /** Its price and terms now, executed change orders included; the document stays as signed. */
  protected readonly current = computed(() => {
    const a = this.a();
    return this.now()?.state ?? (a && agreementState(a));
  });
  protected readonly canRequest = computed(() => {
    const now = this.now();
    return !!now && !now.openAmendmentId && !now.offeredAsIs;
  });
  protected readonly isUnsigned = isUnsignedAmendment;

  protected readonly requesting = signal(false);
  protected readonly catalog = resource({
    params: () => (this.requesting() ? this.ordersOf() : undefined),
    loader: ({ params }) =>
      this.api.get<{ options: HouseDetail; selections: Selections }>(
        API.amendments.options(params),
      ),
  });
  protected readonly options = computed(() =>
    this.catalog.hasValue() ? this.catalog.value()?.options : undefined,
  );
  protected readonly picked = signal<Selections>({});
  protected readonly requestNote = signal('');
  protected readonly requestedChanges = computed(() => {
    const base = this.now()?.selections;
    const o = this.options();
    if (!base || !o) return [];
    const contents = new Map(
      o.areas.flatMap((area) => area.packages.map((p) => [p.id, p.itemIds] as const)),
    );
    return diffSelections(base, this.picked(), (id) => contents.get(id));
  });
  protected readonly estimate = livePrice(
    () => {
      const id = this.ordersOf();
      const changes = this.requestedChanges();
      return this.requesting() && id && changes.length ? { id, changes } : null;
    },
    ({ id, changes }) => this.api.post<AmendmentPreview>(API.amendments.preview(id), { changes }),
  );
  protected readonly canSend = computed(
    () =>
      !this.busy() &&
      (this.requestNote().trim().length > 0 || this.requestedChanges().length > 0) &&
      (!this.requestedChanges().length || (!this.estimate.pending() && !this.estimate.error())),
  );
  protected readonly payments = resource({
    params: () => {
      const a = this.a();
      return a && isRefundableAgreement(a.status) && !a.viewerPurchaserId ? a.id : undefined;
    },
    loader: ({ params }) => this.api.get<BuyerLedger>(API.payments.ledger(params)),
  });
  protected readonly paid = computed(() =>
    this.payments.hasValue() ? this.payments.value() : undefined,
  );
  protected readonly receipt = signal<BuyerPayment | null>(null);
  protected readonly receiptTitle = {
    payment: $localize`:@@agreementRoom.receipt.title:Payment receipt`,
    refund: $localize`:@@agreementRoom.receipt.refundTitle:Refund confirmation`,
  };
  protected readonly LINE = INSTALMENT_LABEL;
  protected readonly METHOD = PAYMENT_METHOD_LABEL;
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
    if (this.a() && this.auth.isTeam()) {
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

  protected openRequest(): void {
    this.picked.set(structuredClone(this.now()?.selections ?? {}));
    this.requestNote.set('');
    this.requesting.set(true);
  }

  protected async sendRequest(a: Agreement): Promise<void> {
    if (!this.canSend()) return;
    const note = this.requestNote().trim();
    const sent = await this.act(() =>
      this.api.post<Amendment>(API.amendments.list(a.id), {
        changes: this.requestedChanges(),
        ...(note && { note }),
      }),
    );
    if (!sent) return;
    this.requesting.set(false);
    this.toast.success(
      $localize`:@@agreementRoom.changeOrders.sent:Sent to ${a.seller.name}:seller:, who will price it in a change order for you to sign`,
    );
  }

  protected async withdraw(order: Amendment): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`:@@agreementRoom.changeOrders.confirmWithdraw.title:Withdraw this change order?`,
      message: $localize`:@@agreementRoom.changeOrders.confirmWithdraw.message:Nothing changes on your agreement, and you can ask again.`,
      confirmLabel: $localize`:@@agreementRoom.changeOrders.confirmWithdraw.confirm:Withdraw`,
    });
    if (!ok) return;
    if (
      await this.act(() =>
        this.api.post<Amendment>(API.amendments.withdraw(order.agreementId, order.id), {}),
      )
    ) {
      this.toast.success($localize`:@@agreementRoom.changeOrders.withdrawn:Change order withdrawn`);
    }
  }

  protected async downloadOrder(order: Amendment): Promise<void> {
    this.downloading.set(true);
    try {
      await downloadAmendment(this.api, order);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.downloading.set(false);
    }
  }

  /** One change-order request at a time; the change orders are reloaded either way. */
  private async act<T>(request: () => Promise<T>): Promise<T | undefined> {
    if (this.busy()) return undefined;
    this.busy.set(true);
    try {
      return await request();
    } catch (err) {
      this.toast.error(err);
      return undefined;
    } finally {
      this.busy.set(false);
      this.orders.reload();
      this.standing.reload();
    }
  }

  protected async downloadReceipt(a: Agreement, p: BuyerPayment): Promise<void> {
    this.downloading.set(true);
    try {
      await downloadReceipt(this.api, a.id, p);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.downloading.set(false);
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
