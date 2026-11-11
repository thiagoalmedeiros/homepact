import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PATHS } from '../core/app-paths';
import { AuthService } from '../core/auth.service';
import { TenantService } from '../core/tenant.service';
import { Icon } from '../shared/icon';
import { Logo } from '../shared/logo';

@Component({
  selector: 'hc-site-nav',
  imports: [RouterLink, RouterLinkActive, Icon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './site-nav.html',
  styleUrl: './site-nav.scss',
})
export class SiteNav {
  protected readonly tenant = inject(TenantService);
  protected readonly auth = inject(AuthService);
  protected readonly paths = PATHS;

  protected firstName(): string | undefined {
    return this.auth.user()?.name.split(' ')[0];
  }
}
