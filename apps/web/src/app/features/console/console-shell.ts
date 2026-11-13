import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { TenantService } from '../../core/tenant.service';
import { Icon } from '../../shared/icon';
import { Logo } from '../../shared/logo';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact: boolean;
}

@Component({
  selector: 'hc-console-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './console-shell.html',
  styleUrl: './console-shell.scss',
})
export class ConsoleShell {
  protected readonly auth = inject(AuthService);
  protected readonly tenant = inject(TenantService);
  private readonly router = inject(Router);
  protected readonly paths = PATHS;
  private readonly items = {
    overview: {
      path: PATHS.console.overview,
      label: $localize`:@@console.shell.nav.overview:Overview`,
      icon: 'grid',
      exact: true,
    },
    proposals: {
      path: PATHS.console.proposals,
      label: $localize`:@@console.shell.nav.proposals:Proposals`,
      icon: 'inbox',
      exact: false,
    },
    agreements: {
      path: PATHS.console.agreements,
      label: $localize`:@@console.shell.nav.agreements:Agreements`,
      icon: 'doc',
      exact: false,
    },
    payments: {
      path: PATHS.console.payments,
      label: $localize`:@@console.shell.nav.payments:Payments`,
      icon: 'cash',
      exact: false,
    },
    inventory: {
      path: PATHS.console.inventory,
      label: $localize`:@@console.shell.nav.inventory:Pre-existing homes`,
      icon: 'location',
      exact: false,
    },
    homes: {
      path: PATHS.console.homes,
      label: $localize`:@@console.shell.nav.homes:Floor plans`,
      icon: 'house',
      exact: false,
    },
    catalog: {
      path: PATHS.console.catalog,
      label: $localize`:@@console.shell.nav.catalog:Packages & options`,
      icon: 'layers',
      exact: false,
    },
    taxes: {
      path: PATHS.console.taxesAndReferrals,
      label: $localize`:@@console.shell.nav.taxesReferrals:Sales tax & referrals`,
      icon: 'percent',
      exact: false,
    },
    team: {
      path: PATHS.console.team,
      label: $localize`:@@console.shell.nav.team:Team`,
      icon: 'users',
      exact: false,
    },
  } satisfies Record<string, NavItem>;

  protected readonly nav = computed((): NavItem[] => {
    const i = this.items;
    return this.auth.isFinance()
      ? [i.payments, i.agreements, i.team]
      : [
          i.overview,
          i.proposals,
          i.agreements,
          i.payments,
          i.inventory,
          i.homes,
          i.catalog,
          i.taxes,
          i.team,
        ];
  });

  protected initials(): string {
    return (this.auth.user()?.name ?? '?')
      .split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('');
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    void this.router.navigateByUrl(PATHS.login);
  }
}
