import { HouseStatus } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, inject, resource, LOCALE_ID } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { House } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { TenantService } from '../../core/tenant.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';

@Component({
  selector: 'hc-console-homes',
  imports: [LoadState, RouterLink, MoneyPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './homes.page.html',
  styleUrl: './homes.page.scss',
})
export class HomesPage {
  protected readonly HouseStatus = HouseStatus;
  protected publishLabel(name: string): string {
    return $localize`:@@console.homes.publish:Publish ${name}:name:`;
  }

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly tenant = inject(TenantService);
  protected readonly paths = PATHS;
  protected readonly locale = inject(LOCALE_ID);
  protected readonly houses = resource({ loader: () => this.api.get<House[]>(API.houses.list) });
  protected currency() {
    return this.tenant.company()?.currency ?? 'CAD';
  }

  protected edit(h: House): void {
    void this.router.navigate(PATHS.console.home(h.id));
  }

  private readonly pending = new Set<string>();

  protected async toggle(h: House): Promise<void> {
    if (this.pending.has(h.id)) return;
    this.pending.add(h.id);
    const publish = h.status !== HouseStatus.Published;
    try {
      const updated = await this.api.post<House>(
        publish ? API.houses.publish(h.id) : API.houses.unpublish(h.id),
      );
      this.houses.update((list) => list?.map((x) => (x.id === h.id ? updated : x)));
      this.toast.success(
        publish
          ? $localize`:@@console.homes.published:${h.name}:name: can now be proposed`
          : $localize`:@@console.homes.unpublished:${h.name}:name: is no longer offered in new proposals`,
      );
    } catch (err) {
      this.toast.error(err);
      this.houses.reload();
    } finally {
      this.pending.delete(h.id);
    }
  }
}
