import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PATHS } from '../core/app-paths';
import { TenantService } from '../core/tenant.service';

@Component({
  selector: 'hc-site-footer',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.scss',
})
export class SiteFooter {
  protected readonly tenant = inject(TenantService);
  protected readonly paths = PATHS;
  protected readonly year = new Date().getFullYear();
}
