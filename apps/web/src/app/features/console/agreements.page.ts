import { AgreementStatus, ProposalStatus } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { AgreementSummary, Proposal } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { AGREEMENT_LABEL } from '../../shared/status';
import { COMMON_TEXT } from '../../shared/text';

type Filter = AgreementStatus | 'all';

@Component({
  selector: 'hc-console-agreements',
  imports: [RouterLink, LoadState, MoneyPipe, RelativeTimePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreements.page.html',
  styleUrl: './agreements.page.scss',
})
export class AgreementsPage {
  protected readonly text = COMMON_TEXT;

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly LABEL = AGREEMENT_LABEL;
  protected readonly paths = PATHS;
  protected readonly filter = signal<Filter>('all');
  protected readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: $localize`:@@console.agreements.filters.all:All` },
    { id: AgreementStatus.Draft, label: $localize`:@@console.agreements.filters.draft:Drafts` },
    {
      id: AgreementStatus.UnderReview,
      label: $localize`:@@console.agreements.filters.under_review:Out for signature`,
    },
    {
      id: AgreementStatus.Signed,
      label: $localize`:@@console.agreements.filters.signed:To countersign`,
    },
    {
      id: AgreementStatus.Executed,
      label: $localize`:@@console.agreements.filters.executed:Executed`,
    },
    {
      id: AgreementStatus.Cancelled,
      label: $localize`:@@console.agreements.filters.cancelled:Cancelled`,
    },
  ];
  protected readonly list = resource({
    loader: () => this.api.get<AgreementSummary[]>(API.agreements.list),
  });
  private readonly signed = resource({
    loader: () => this.api.get<Proposal[]>(API.proposals.list, { status: ProposalStatus.Signed }),
  });
  private readonly all = computed(() => (this.list.hasValue() ? this.list.value() : []));
  protected readonly visible = computed(() =>
    this.all().filter((a) => this.filter() === 'all' || a.status === this.filter()),
  );
  protected readonly ready = computed(() => {
    if (!this.list.hasValue() || !this.signed.hasValue()) return [];
    const covered = new Set(
      this.all()
        .filter((a) => a.status !== AgreementStatus.Cancelled)
        .map((a) => a.proposalId),
    );
    return this.signed.value().filter((p) => !covered.has(p.id));
  });

  protected open(a: AgreementSummary): void {
    void this.router.navigate(PATHS.console.agreement(a.id));
  }
}
