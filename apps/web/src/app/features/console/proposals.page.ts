import { isActiveProposal, Party, ProposalStatus } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Proposal } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { turnOf } from '../../shared/status';
import { COMMON_TEXT } from '../../shared/text';

type Filter = 'review' | 'active' | 'signed' | 'closed' | 'all';

const MATCH: Record<Filter, (p: Proposal) => boolean> = {
  review: (p) => p.status === ProposalStatus.ChangesRequested,
  active: (p) => isActiveProposal(p.status),
  signed: (p) => p.status === ProposalStatus.Signed,
  closed: (p) => p.status === ProposalStatus.Declined || p.status === ProposalStatus.Withdrawn,
  all: () => true,
};

@Component({
  selector: 'hc-console-proposals',
  imports: [RouterLink, LoadState, MoneyPipe, RelativeTimePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './proposals.page.html',
  styleUrl: './proposals.page.scss',
})
export class ProposalsPage {
  protected readonly Party = Party;
  protected readonly text = COMMON_TEXT;

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  protected readonly turnOf = turnOf;
  protected readonly paths = PATHS;
  protected readonly filter = signal<Filter>('active');
  protected readonly mine = signal(false);
  protected readonly filters: { id: Filter; label: string }[] = [
    { id: 'review', label: $localize`:@@console.proposals.filters.review:Needs review` },
    { id: 'active', label: $localize`:@@console.proposals.filters.active:Active` },
    { id: 'signed', label: $localize`:@@console.proposals.filters.signed:Signed` },
    { id: 'closed', label: $localize`:@@console.proposals.filters.closed:Closed` },
    { id: 'all', label: $localize`:@@console.proposals.filters.all:All` },
  ];
  protected readonly list = resource({
    loader: () => this.api.get<Proposal[]>(API.proposals.list),
  });
  private readonly all = computed(
    () => (this.list.hasValue() ? this.list.value() : undefined) ?? [],
  );
  protected readonly reviewCount = computed(() => this.all().filter(MATCH.review).length);
  protected readonly visible = computed(() => {
    const me = this.auth.user()?.id;
    return this.all().filter((p) => MATCH[this.filter()](p) && (!this.mine() || p.repId === me));
  });

  private filterChosen = false;

  constructor() {
    effect(() => this.openOnReviewQueueWhenBuyersWait());
  }

  private openOnReviewQueueWhenBuyersWait(): void {
    const waiting = this.reviewCount();
    if (this.filterChosen || !this.list.hasValue()) return;
    this.filterChosen = true;
    if (waiting) untracked(() => this.filter.set('review'));
  }

  protected open(p: Proposal): void {
    void this.router.navigate(PATHS.console.proposal(p.id));
  }
}
