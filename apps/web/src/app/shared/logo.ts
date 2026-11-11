import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { TenantService } from '../core/tenant.service';

/** The tenant's logo — the only per-company branding — with a text fallback. */
@Component({
  selector: 'hc-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './logo.html',
  styleUrl: './logo.scss',
})
export class Logo {
  protected readonly tenant = inject(TenantService);
  readonly height = input(30);
  protected readonly failed = signal(false);
}
