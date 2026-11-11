import { Injectable, computed, inject, signal } from '@angular/core';
import type { TenantBranding } from '@homepact/shared';
import { API } from './api-endpoints';
import { ApiService } from './api.service';

/** Branding of the company that owns this origin (or the platform console). */
@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly api = inject(ApiService);
  readonly branding = signal<TenantBranding | null>(null);
  readonly error = signal<string | null>(null);
  readonly isPlatform = computed(() => this.branding()?.kind === 'platform');
  readonly company = computed(() => {
    const b = this.branding();
    return b?.kind === 'company' ? b : null;
  });

  async load(): Promise<void> {
    try {
      const branding = await this.api.get<TenantBranding>(API.tenant);
      this.branding.set(branding);
      if (typeof document !== 'undefined') document.title = branding.name;
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : $localize`:@@errors.unknownSite:Unknown site`,
      );
      if (typeof document !== 'undefined')
        document.title = $localize`:@@app.unknownSite.title:This site isn't set up yet`;
    }
  }
}
