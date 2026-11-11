import { ChangeRequestStatus, isActiveProposal, Party } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type {
  Adjustment,
  Agreement,
  AgreementUpdate,
  ChangePreview,
  ChangeRequest,
  HouseDetail,
  ProposalDetail,
  QuoteSnapshot,
  ReferralProgram,
  RevisionCreate,
  Selections,
  TaxRate,
} from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { AdjustmentsEditor, cleanAdjustments } from '../../shared/adjustments-editor';
import { LocalDatePipe } from '../../shared/dates';
import { Icon } from '../../shared/icon';
import { InviteSheet } from '../../shared/invite-sheet';
import { livePrice } from '../../shared/live-price';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { ProposalMessages } from '../../shared/proposal-messages';
import { ProposalTimeline } from '../../shared/proposal-timeline';
import { QuoteBreakdown } from '../../shared/quote-breakdown';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { SelectionEditor } from '../../shared/selection-editor';
import { AGREEMENT_LABEL, turnOf } from '../../shared/status';
import {
  referralDraftOf,
  referralIncomplete,
  referralOf,
  TaxReferralEditor,
  type ReferralDraft,
} from '../../shared/tax-referral-editor';
import { AgreementTermsSheet } from './agreement-terms-sheet';
import { COMMON_TEXT } from '../../shared/text';

interface Decision {
  approved: boolean | null;
  note: string;
}

const sameAdjustments = (a: Adjustment[], b: Adjustment[]) =>
  JSON.stringify(a) === JSON.stringify(b);

@Component({
  selector: 'hc-console-proposal',
  imports: [
    FormsModule,
    RouterLink,
    LoadState,
    MoneyPipe,
    RelativeTimePipe,
    QuoteBreakdown,
    SelectionEditor,
    AdjustmentsEditor,
    ProposalTimeline,
    ProposalMessages,
    InviteSheet,
    AgreementTermsSheet,
    TaxReferralEditor,
    Icon,
    LocalDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './proposal-detail.page.html',
  styleUrl: './proposal-detail.page.scss',
})
export class ProposalDetailPage {
  protected readonly Party = Party;
  protected decisionLabel(change: string): string {
    return $localize`:@@console.detail.review.decisionFor:Decision for ${change}:label:`;
  }

  protected readonly defaultBuyer = COMMON_TEXT.buyer;
  protected readonly theBuyer = COMMON_TEXT.theBuyer;
  protected readonly answerFirst = $localize`:@@console.detail.answerFirst:Answer the open request first`;

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  protected readonly paths = PATHS;
  readonly id = input.required<string>();
  protected readonly turnOf = turnOf;
  protected readonly agreementLabel = AGREEMENT_LABEL;
  protected readonly preparing = signal(false);

  protected readonly detail = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.get<ProposalDetail>(API.proposals.one(params)),
  });
  private readonly d = computed(() => (this.detail.hasValue() ? this.detail.value() : undefined));
  protected readonly options = resource({
    params: () => (this.mode() === 'revise' ? this.id() : undefined),
    loader: ({ params }) => this.api.get<HouseDetail>(API.proposals.options(params)),
  });

  protected readonly busy = signal(false);
  protected readonly mode = signal<'view' | 'revise'>('view');
  protected readonly viewRev = signal<number | null>(null);
  protected readonly newKey = signal<string | null>(null);

  protected readonly active = computed(() => {
    const s = this.d()?.proposal.status;
    return !!s && isActiveProposal(s);
  });
  protected readonly currentRev = computed(() => {
    const d = this.d();
    return d?.revisions.find((r) => r.number === d.proposal.currentRevision);
  });
  protected readonly shownRev = computed(() => {
    const d = this.d();
    const n = this.viewRev();
    return (n && d?.revisions.find((r) => r.number === n)) || this.currentRev();
  });
  protected readonly openRequest = computed(() => {
    const d = this.d();
    return d?.changeRequests.find(
      (c) => c.id === d.proposal.openChangeRequestId && c.status === ChangeRequestStatus.Open,
    );
  });

  protected readonly decisions = signal<Record<string, Decision>>({});
  protected readonly answerAdjustments = signal<Adjustment[]>([]);
  protected answerNote = '';
  protected readonly allDecided = computed(() => {
    const cr = this.openRequest();
    return !!cr && cr.changes.every((c) => this.decisions()[c.id]?.approved != null);
  });
  private readonly approvedChanges = computed(() => {
    const cr = this.openRequest();
    return cr
      ? cr.changes.filter((c) => this.decisions()[c.id]?.approved === true).map((c) => c.change)
      : [];
  });
  protected readonly willRevise = computed(
    () =>
      this.approvedChanges().length > 0 ||
      !sameAdjustments(
        cleanAdjustments(this.answerAdjustments()),
        this.currentRev()?.quote.adjustments ?? [],
      ),
  );
  protected readonly answerPreview = livePrice(
    () => {
      const cr = this.openRequest();
      if (!cr) return null;
      return {
        changes: this.approvedChanges(),
        adjustments: cleanAdjustments(this.answerAdjustments()),
      };
    },
    (body) => this.api.post<ChangePreview>(API.proposals.previewChanges(this.id()), body),
  );

  protected readonly reviseSelections = signal<Selections>({});
  protected readonly reviseAdjustments = signal<Adjustment[]>([]);
  protected readonly reviseTaxRegion = signal<string | null>(null);
  protected readonly reviseReferral = signal<ReferralDraft | null>(null);
  protected readonly reviseReferralIncomplete = computed(() =>
    referralIncomplete(this.reviseReferral()),
  );
  protected reviseNote = '';
  protected readonly taxRates = resource({
    params: () => (this.mode() === 'revise' ? true : undefined),
    loader: () => this.api.get<TaxRate[]>(API.taxRates.list),
  });
  protected readonly programs = resource({
    params: () => (this.mode() === 'revise' ? true : undefined),
    loader: () => this.api.get<ReferralProgram[]>(API.referralPrograms.list),
  });
  /** The revision as it would be sent: configuration, adjustments, province and referral. */
  private readonly revision = (withContact: boolean): RevisionCreate => ({
    selections: this.reviseSelections(),
    adjustments: cleanAdjustments(this.reviseAdjustments()),
    taxRegion: this.reviseTaxRegion(),
    referral: referralOf(this.reviseReferral(), { withContact }),
  });
  protected readonly revisePreview = livePrice(
    () => (this.mode() === 'revise' && this.d() ? this.revision(false) : null),
    (body) => this.api.post<QuoteSnapshot>(API.proposals.previewRevision(this.id()), body),
  );

  constructor() {
    effect(() => this.startAnswerFresh());
  }

  private startAnswerFresh(): void {
    const cr = this.openRequest();
    const adjustments = this.currentRev()?.quote.adjustments ?? [];
    untracked(() => {
      this.decisions.set({});
      this.answerAdjustments.set(adjustments.map((a) => ({ ...a })));
      this.answerNote = '';
      if (cr) this.mode.set('view');
    });
  }

  protected decide(changeId: string, approved: boolean): void {
    this.decisions.update((d) => ({
      ...d,
      [changeId]: { note: d[changeId]?.note ?? '', approved },
    }));
  }

  protected decideNote(changeId: string, note: string): void {
    this.decisions.update((d) => ({
      ...d,
      [changeId]: { approved: d[changeId]?.approved ?? false, note },
    }));
  }

  protected decideAll(cr: ChangeRequest, approved: boolean): void {
    for (const c of cr.changes) this.decide(c.id, approved);
  }

  protected async sendAnswer(cr: ChangeRequest): Promise<void> {
    const decisions = cr.changes.map((c) => {
      const d = this.decisions()[c.id]!;
      return {
        changeId: c.id,
        approved: !!d.approved,
        ...(!d.approved && d.note.trim() && { note: d.note.trim() }),
      };
    });
    await this.run(
      () =>
        this.api.post<ProposalDetail>(API.proposals.decide(this.id(), cr.id), {
          decisions,
          adjustments: cleanAdjustments(this.answerAdjustments()),
          ...(this.answerNote.trim() && { note: this.answerNote.trim() }),
        }),
      this.willRevise()
        ? $localize`:@@console.detail.toasts.revisionSent:Revision sent to the buyer`
        : $localize`:@@console.detail.toasts.answerSent:Answer sent to the buyer`,
    );
  }

  protected startRevise(): void {
    const rev = this.currentRev();
    this.reviseSelections.set(structuredClone(rev?.selections ?? {}));
    this.reviseAdjustments.set((rev?.quote.adjustments ?? []).map((a) => ({ ...a })));
    this.reviseTaxRegion.set(rev?.quote.tax?.regionCode ?? null);
    this.reviseReferral.set(referralDraftOf(rev?.quote));
    this.reviseNote = '';
    this.mode.set('revise');
  }

  protected async sendRevision(): Promise<void> {
    if (this.reviseReferralIncomplete()) return;
    const ok = await this.run(
      () =>
        this.api.post<ProposalDetail>(API.proposals.revisions(this.id()), {
          ...this.revision(true),
          ...(this.reviseNote.trim() && { note: this.reviseNote.trim() }),
        }),
      $localize`:@@console.detail.toasts.revisionSent:Revision sent to the buyer`,
    );
    if (ok) this.mode.set('view');
  }

  protected toggleLock(locked: boolean): void {
    void this.run(
      () => this.api.post<ProposalDetail>(API.proposals.lock(this.id()), { locked }),
      locked
        ? $localize`:@@console.detail.toasts.locked:Locked: sold as built`
        : $localize`:@@console.detail.toasts.unlocked:Unlocked: the buyer can request changes`,
    );
  }

  protected async withdraw(): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`:@@console.detail.confirmWithdraw.title:Withdraw this proposal?`,
      message: $localize`:@@console.detail.confirmWithdraw.message:The buyer will no longer be able to sign it. This cannot be undone.`,
      confirmLabel: $localize`:@@console.detail.confirmWithdraw.confirm:Withdraw`,
      destructive: true,
    });
    if (ok)
      await this.run(
        () => this.api.post<ProposalDetail>(API.proposals.withdraw(this.id())),
        $localize`:@@console.detail.toasts.withdrawn:Proposal withdrawn`,
      );
  }

  protected async rotate(): Promise<void> {
    const keyId = this.d()?.proposal.accessKeyId;
    if (!keyId) return;
    const ok = await this.confirm.ask({
      title: $localize`:@@console.detail.confirmRotate.title:Replace the invite link?`,
      message: $localize`:@@console.detail.confirmRotate.message:The current link stops working immediately. You will get a new link to send.`,
      confirmLabel: $localize`:@@console.detail.confirmRotate.confirm:Replace link`,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const res = await this.api.post<{ accessKey: string }>(API.accessKeys.rotate(keyId));
      this.newKey.set(res.accessKey);
      this.detail.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendMessage(body: string): Promise<void> {
    try {
      await this.api.post(API.proposals.messages(this.id()), { body });
      this.detail.reload();
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected readonly initialTerms = computed((): Partial<AgreementUpdate> => {
    const p = this.d()?.proposal;
    const name = p?.buyer.name?.trim() || p?.signature?.fullName;
    return {
      purchasers: name
        ? [
            {
              name,
              ...(p?.buyer.email && { email: p.buyer.email }),
              ...(p?.buyer.phone && { phone: p.buyer.phone }),
            },
          ]
        : [],
    };
  });

  protected async prepareAgreement(terms: AgreementUpdate): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const a = await this.api.post<Agreement>(API.agreements.list, {
        proposalId: this.id(),
        ...terms,
      });
      this.preparing.set(false);
      this.toast.success(
        $localize`:@@console.detail.agreement.prepared:Draft ${a.reference}:reference: ready for review`,
      );
      void this.router.navigate(PATHS.console.agreement(a.id));
    } catch (err) {
      this.toast.error(err);
      this.detail.reload();
    } finally {
      this.busy.set(false);
    }
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
