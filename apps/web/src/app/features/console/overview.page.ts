import { InventoryStatus, Party, ProposalStatus } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { InventoryHome, Proposal } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { TenantService } from '../../core/tenant.service';
import { LocalDatePipe } from '../../shared/dates';
import { Icon } from '../../shared/icon';
import { COMMON_TEXT } from '../../shared/text';
import { MoneyPipe } from '../../shared/money.pipe';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { turnOf } from '../../shared/status';

@Component({
  selector: 'hc-console-overview',
  imports: [RouterLink, MoneyPipe, RelativeTimePipe, LocalDatePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.scss',
})
export class OverviewPage {
  protected readonly Party = Party;
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  protected readonly turnOf = turnOf;
  protected readonly paths = PATHS;
  protected readonly proposals = resource({
    loader: () => this.api.get<Proposal[]>(API.proposals.list),
  });
  protected readonly inventory = resource({
    loader: () => this.api.get<InventoryHome[]>(API.inventory.list),
  });
  private readonly all = computed(
    () => (this.proposals.hasValue() ? this.proposals.value() : undefined) ?? [],
  );
  protected readonly currency = computed(() => this.tenant.company()?.currency ?? 'CAD');
  protected readonly review = computed(() =>
    this.all().filter((p) => p.status === ProposalStatus.ChangesRequested),
  );
  protected readonly withBuyer = computed(
    () => this.all().filter((p) => p.status === ProposalStatus.Proposed).length,
  );
  protected readonly signedValue = computed(() =>
    this.all().reduce((t, p) => t + (p.signature?.totalCents ?? 0), 0),
  );
  protected readonly available = computed(
    () =>
      ((this.inventory.hasValue() ? this.inventory.value() : undefined) ?? []).filter(
        (h) => h.status === InventoryStatus.Available,
      ).length,
  );
  protected readonly recent = computed(() => this.all().slice(0, 8));
  protected readonly today = new Date();
  protected readonly text = COMMON_TEXT;
  protected readonly greeting = computed(() => {
    const name = this.auth.user()?.name?.split(' ')[0] ?? '';
    const hour = this.today.getHours();
    return hour < 12
      ? $localize`:@@console.overview.greeting.morning:Good morning, ${name}:name:.`
      : hour < 18
        ? $localize`:@@console.overview.greeting.afternoon:Good afternoon, ${name}:name:.`
        : $localize`:@@console.overview.greeting.evening:Good evening, ${name}:name:.`;
  });
}
