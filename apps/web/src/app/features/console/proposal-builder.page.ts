import { HouseStatus, InventoryStatus } from '@homepact/shared/enums';
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
  LOCALE_ID,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type {
  Adjustment,
  House,
  HouseDetail,
  InventoryHome,
  ProposalCreated,
  ProposalQuoteRequest,
  QuoteSnapshot,
  ReferralProgram,
  Selections,
  TaxRate,
} from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { ToastService } from '../../core/toast.service';
import { AdjustmentsEditor, cleanAdjustments } from '../../shared/adjustments-editor';
import { Icon } from '../../shared/icon';
import { InviteSheet } from '../../shared/invite-sheet';
import { livePrice } from '../../shared/live-price';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { QuoteBreakdown } from '../../shared/quote-breakdown';
import { SelectionEditor } from '../../shared/selection-editor';
import {
  referralIncomplete,
  referralOf,
  TaxReferralEditor,
  type ReferralDraft,
} from '../../shared/tax-referral-editor';

type Step = 'start' | 'plan' | 'configure' | 'home' | 'buyer';

/** Builds a quote with the buyer, from a floor plan or a pre-existing home, then sends the
 * proposal link. */
@Component({
  selector: 'hc-proposal-builder',
  imports: [
    FormsModule,
    RouterLink,
    LoadState,
    MoneyPipe,
    QuoteBreakdown,
    SelectionEditor,
    AdjustmentsEditor,
    InviteSheet,
    TaxReferralEditor,
    Icon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './proposal-builder.page.html',
  styleUrl: './proposal-builder.page.scss',
})
export class ProposalBuilderPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly paths = PATHS;
  protected readonly locale = inject(LOCALE_ID);
  readonly from = input<string>();

  protected readonly step = signal<Step>('start');
  protected readonly houses = resource({ loader: () => this.api.get<House[]>(API.houses.list) });
  protected readonly inventory = resource({
    loader: () => this.api.get<InventoryHome[]>(API.inventory.list),
  });
  protected readonly plans = computed(() =>
    ((this.houses.hasValue() ? this.houses.value() : undefined) ?? []).filter(
      (h) => h.status === HouseStatus.Published,
    ),
  );
  protected readonly availableHomes = computed(() =>
    ((this.inventory.hasValue() ? this.inventory.value() : undefined) ?? []).filter(
      (h) => h.status === InventoryStatus.Available,
    ),
  );

  protected readonly plan = signal<House | null>(null);
  protected readonly planDetail = resource({
    params: () => this.plan()?.id,
    loader: ({ params }) => this.api.get<HouseDetail>(API.houses.detail(params)),
  });
  protected readonly selections = signal<Selections>({});
  protected readonly adjustments = signal<Adjustment[]>([]);
  protected readonly home = signal<InventoryHome | null>(null);

  protected readonly taxRates = resource({
    loader: () => this.api.get<TaxRate[]>(API.taxRates.list),
  });
  protected readonly programs = resource({
    loader: () => this.api.get<ReferralProgram[]>(API.referralPrograms.list),
  });
  protected readonly taxRegion = signal<string | null | undefined>(undefined);
  protected readonly referral = signal<ReferralDraft | null>(null);
  protected readonly referralIncomplete = computed(() => referralIncomplete(this.referral()));

  private readonly pricing = computed((): ProposalQuoteRequest | null => {
    const region = this.taxRegion();
    const referral = referralOf(this.referral(), { withContact: false });
    const extras = {
      ...(region !== undefined && { taxRegion: region }),
      ...(referral && { referral }),
    };
    const home = this.home();
    if (home) return { inventoryHomeId: home.id, ...extras };
    const plan = this.plan();
    if (!plan) return null;
    return {
      houseId: plan.id,
      selections: this.selections(),
      adjustments: cleanAdjustments(this.adjustments()),
      ...extras,
    };
  });
  protected readonly liveQuote = livePrice(
    () => (this.step() === 'start' ? null : this.pricing()),
    (body) => this.api.post<QuoteSnapshot>(API.proposals.quote, body),
  );

  protected locked = true;

  protected buyer = { name: '', email: '', phone: '' };
  protected note = '';
  protected readonly busy = signal(false);
  protected readonly created = signal<ProposalCreated | null>(null);
  private history: Step[] = [];

  private readonly subtitles: Record<Step, string> = {
    start: $localize`:@@console.builder.steps.start:How would you like to start?`,
    plan: $localize`:@@console.builder.steps.plan:Choose a floor plan.`,
    configure: $localize`:@@console.builder.steps.configure:Choose packages and options with your buyer.`,
    home: $localize`:@@console.builder.steps.home:Choose a pre-existing home.`,
    buyer: $localize`:@@console.builder.steps.buyer:Add the buyer and send them the proposal.`,
  };
  protected readonly subtitle = computed(() => this.subtitles[this.step()]);
  protected readonly summaryTitle = computed(() =>
    this.home() ? `${this.home()!.houseName} · ${this.home()!.address}` : (this.plan()?.name ?? ''),
  );
  protected readonly summaryQuote = computed(() => this.liveQuote.value());

  private pendingDefaults = false;

  constructor() {
    effect(() => this.startWithIncludedPackages());
    effect(() => this.startInDefaultProvince());
    effect(() => this.startAtRequestedStep());
  }

  private startWithIncludedPackages(): void {
    const d = this.planDetail.hasValue() ? this.planDetail.value() : undefined;
    if (!d || !this.pendingDefaults) return;
    untracked(() => {
      this.pendingDefaults = false;
      const included: Selections = {};
      for (const a of d.areas) {
        const pkg = a.packages.find((p) => p.priceCents === 0);
        if (pkg) included[a.slug] = { packageId: pkg.id };
      }
      this.selections.set(included);
    });
  }

  private startInDefaultProvince(): void {
    const rates = this.taxRates.hasValue() ? this.taxRates.value() : undefined;
    if (!rates) return;
    untracked(() => {
      if (this.taxRegion() !== undefined) return;
      this.taxRegion.set((rates.find((r) => r.isDefault) ?? rates[0])?.code ?? null);
    });
  }

  private startAtRequestedStep(): void {
    const from = this.from();
    untracked(() => {
      if (from === 'plan' || from === 'home') this.step.set(from);
    });
  }

  protected go(step: Step): void {
    this.history.push(this.step());
    if (step === 'plan') this.home.set(null);
    if (step === 'home') this.plan.set(null);
    this.step.set(step);
  }

  protected back(): void {
    this.step.set(this.history.pop() ?? 'start');
  }

  protected choosePlan(h: House): void {
    if (this.plan()?.id !== h.id) {
      this.selections.set({});
      this.adjustments.set([]);
      this.pendingDefaults = true;
    }
    this.plan.set(h);
    this.go('configure');
  }

  protected chooseHome(h: InventoryHome): void {
    this.home.set(h);
    this.locked = h.lockedByDefault;
  }

  protected async create(): Promise<void> {
    if (this.busy() || this.referralIncomplete()) return;
    this.busy.set(true);
    const buyer = Object.fromEntries(Object.entries(this.buyer).filter(([, v]) => v.trim()));
    const home = this.home();
    const region = this.taxRegion();
    const referral = referralOf(this.referral());
    const body = {
      ...(home
        ? { inventoryHomeId: home.id, locked: this.locked }
        : {
            houseId: this.plan()!.id,
            selections: this.selections(),
            adjustments: cleanAdjustments(this.adjustments()),
          }),
      ...(region !== undefined && { taxRegion: region }),
      ...(referral && { referral }),
    };
    try {
      this.created.set(
        await this.api.post<ProposalCreated>(API.proposals.list, {
          ...body,
          buyer,
          ...(this.note.trim() && { note: this.note.trim() }),
        }),
      );
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected finish(c: ProposalCreated): void {
    this.created.set(null);
    void this.router.navigate(PATHS.console.proposal(c.proposal.id), { replaceUrl: true });
  }
}
