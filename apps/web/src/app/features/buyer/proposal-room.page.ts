import {
  AgreementStatus,
  ChangeRequestStatus,
  Party,
  ProposalStatus,
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
import type { ChangePreview, HouseDetail, ProposalDetail, Selections } from '@homepact/shared';
import { diffSelections } from '@homepact/shared/changes';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { TenantService } from '../../core/tenant.service';
import { ToastService } from '../../core/toast.service';
import { LocalDatePipe } from '../../shared/dates';
import { Icon } from '../../shared/icon';
import { livePrice } from '../../shared/live-price';
import { MoneyPipe } from '../../shared/money.pipe';
import { ChangeLines } from '../../shared/change-lines';
import { MortgageEstimator } from '../../shared/mortgage-estimator';
import { ProposalMessages } from '../../shared/proposal-messages';
import { ProposalTimeline } from '../../shared/proposal-timeline';
import { QuoteBreakdown } from '../../shared/quote-breakdown';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { SelectionEditor } from '../../shared/selection-editor';
import { Sheet } from '../../shared/sheet';
import { turnOf } from '../../shared/status';
import { COMMON_TEXT } from '../../shared/text';

/** The buyer's proposal room: review, ask for changes, follow the answers and sign. */
@Component({
  selector: 'hc-proposal-room',
  imports: [
    FormsModule,
    RouterLink,
    MoneyPipe,
    RelativeTimePipe,
    QuoteBreakdown,
    SelectionEditor,
    ChangeLines,
    MortgageEstimator,
    ProposalTimeline,
    ProposalMessages,
    Sheet,
    Icon,
    LocalDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './proposal-room.page.html',
  styleUrl: './proposal-room.page.scss',
})
export class ProposalRoomPage {
  protected readonly ProposalStatus = ProposalStatus;
  protected readonly AgreementStatus = AgreementStatus;
  protected readonly Party = Party;
  protected readonly ChangeRequestStatus = ChangeRequestStatus;
  protected readonly theSeller = COMMON_TEXT.theSeller;

  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly tenant = inject(TenantService);
  protected readonly paths = PATHS;
  readonly id = input.required<string>();
  protected readonly turnOf = turnOf;

  private readonly outsider = this.auth.isTeam() && !this.auth.isStaff();
  protected readonly detail = resource({
    params: () => (this.outsider ? undefined : this.id()),
    loader: ({ params }) => this.api.get<ProposalDetail>(API.proposals.one(params)),
  });
  protected readonly d = computed(() => (this.detail.hasValue() ? this.detail.value() : undefined));
  protected readonly mode = signal<'view' | 'change'>('view');
  protected readonly options = resource({
    params: () => (this.mode() === 'change' ? this.id() : undefined),
    loader: ({ params }) => this.api.get<HouseDetail>(API.proposals.options(params)),
  });
  protected readonly sheet = signal<'review' | 'sign' | null>(null);
  protected readonly busy = signal(false);
  protected readonly viewRev = signal<number | null>(null);

  protected readonly p = computed(() => this.d()?.proposal);
  protected readonly current = computed(() => {
    const d = this.d();
    return d?.revisions.find((r) => r.number === d.proposal.currentRevision);
  });
  protected readonly shown = computed(() => {
    const n = this.viewRev();
    return (n && this.d()?.revisions.find((r) => r.number === n)) || this.current();
  });
  protected readonly openRequest = computed(() => {
    const d = this.d();
    return d?.changeRequests.find((c) => c.status === ChangeRequestStatus.Open);
  });
  protected readonly lastAnswer = computed(() => {
    const d = this.d();
    const last = d?.changeRequests.at(-1);
    if (
      !d ||
      d.proposal.status !== ProposalStatus.Proposed ||
      last?.status !== ChangeRequestStatus.Resolved
    )
      return undefined;
    return (last.resultRevision ?? last.baseRevision) === d.proposal.currentRevision
      ? last
      : undefined;
  });
  protected readonly canChange = computed(
    () => this.p()?.status === ProposalStatus.Proposed && !this.p()?.locked,
  );
  protected readonly canSign = computed(() => this.p()?.status === ProposalStatus.Proposed);
  protected readonly firstName = computed(
    () =>
      this.p()?.repName?.split(' ')[0] ??
      $localize`:@@common.yourRepresentative:your representative`,
  );
  protected readonly isGuest = computed(() => !this.auth.user() && !!this.auth.guest());

  protected readonly draft = signal<Selections>({});
  protected readonly changes = computed(() => {
    const base = this.current()?.selections;
    const o = this.options.hasValue() ? this.options.value() : undefined;
    if (!base || !o) return [];
    const contents = new Map(
      o.areas.flatMap((a) => a.packages.map((p) => [p.id, p.itemIds] as const)),
    );
    return diffSelections(base, this.draft(), (id) => contents.get(id));
  });
  protected readonly preview = livePrice(
    () => (this.mode() === 'change' && this.changes().length ? this.changes() : null),
    (changes) => this.api.post<ChangePreview>(API.proposals.previewChanges(this.id()), { changes }),
  );
  protected requestNote = '';

  protected fullName = '';
  protected agree = false;

  constructor() {
    if (this.outsider) void this.router.navigateByUrl(this.auth.home(), { replaceUrl: true });
    effect(() => this.sendSellersToTheConsole());
  }

  private sendSellersToTheConsole(): void {
    if (this.d()?.viewerParty === Party.Seller) {
      void this.router.navigate(PATHS.console.proposal(this.id()), { replaceUrl: true });
    }
  }

  protected startChanges(): void {
    this.draft.set(structuredClone(this.current()?.selections ?? {}));
    this.requestNote = '';
    this.mode.set('change');
    document.querySelector('main')?.scrollIntoView?.({ behavior: 'smooth' });
  }

  protected cancelChanges(): void {
    this.mode.set('view');
    this.sheet.set(null);
  }

  protected async sendRequest(): Promise<void> {
    const rev = this.p()?.currentRevision;
    if (!rev || !this.changes().length) return;
    const ok = await this.run(
      () =>
        this.api.post<ProposalDetail>(API.proposals.changeRequests(this.id()), {
          baseRevision: rev,
          changes: this.changes(),
          ...(this.requestNote.trim() && { note: this.requestNote.trim() }),
        }),
      $localize`:@@room.toasts.sentTo:Sent to ${this.firstName()}:rep: for review`,
    );
    if (ok) {
      this.sheet.set(null);
      this.mode.set('view');
    }
  }

  protected async withdrawRequest(crId: string): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`:@@room.confirmWithdraw.title:Withdraw your change request?`,
      message: $localize`:@@room.confirmWithdraw.message:The proposal goes back to the current revision, and you can ask again.`,
      confirmLabel: $localize`:@@room.confirmWithdraw.confirm:Withdraw request`,
    });
    if (ok) {
      await this.run(
        () => this.api.post<ProposalDetail>(API.proposals.withdrawRequest(this.id(), crId)),
        $localize`:@@room.toasts.requestWithdrawn:Request withdrawn`,
      );
    }
  }

  protected openSign(): void {
    this.fullName = this.p()?.buyer.name ?? '';
    this.agree = false;
    this.sheet.set('sign');
  }

  protected async sign(): Promise<void> {
    const rev = this.p()?.currentRevision;
    if (!rev) return;
    const ok = await this.run(
      () =>
        this.api.post<ProposalDetail>(API.proposals.sign(this.id()), {
          revision: rev,
          fullName: this.fullName.trim(),
          agree: true,
        }),
      $localize`:@@room.toasts.signed:Signed. Congratulations on your new home!`,
    );
    if (ok) this.sheet.set(null);
  }

  protected async decline(): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`:@@room.confirmDecline.title:Decline this proposal?`,
      message: $localize`:@@room.confirmDecline.message:${this.firstName()}:rep: will be told you've decided not to go ahead. This cannot be undone.`,
      confirmLabel: $localize`:@@room.confirmDecline.confirm:Decline proposal`,
      destructive: true,
    });
    if (ok)
      await this.run(
        () => this.api.post<ProposalDetail>(API.proposals.decline(this.id())),
        $localize`:@@room.toasts.declined:Proposal declined`,
      );
  }

  protected async sendMessage(body: string): Promise<void> {
    try {
      this.detail.set(
        await this.api.post<ProposalDetail>(API.proposals.messages(this.id()), { body }),
      );
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected print(): void {
    window.print();
  }

  private async run(request: () => Promise<ProposalDetail>, success: string): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    try {
      this.detail.set(await request());
      this.viewRev.set(null);
      this.toast.success(success);
      return true;
    } catch (err) {
      this.toast.error(err);
      this.detail.reload();
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
