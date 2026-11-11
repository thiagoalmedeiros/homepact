import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface RuntimeConfig {
  apiBaseUrl: string;
}

/** The runtime `config.json`, read before bootstrap: one build serves every deployment. */
@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private readonly http = inject(HttpClient);
  private value: RuntimeConfig = { apiBaseUrl: '' };

  get config(): RuntimeConfig {
    return this.value;
  }

  async load(url = '/config.json'): Promise<RuntimeConfig> {
    const raw = await firstValueFrom(this.http.get<Partial<RuntimeConfig>>(url));
    this.value = { apiBaseUrl: (raw.apiBaseUrl ?? '').replace(/\/+$/, '') };
    return this.value;
  }

  apiUrl(path: string): string {
    return `${this.value.apiBaseUrl}/api${path.startsWith('/') ? path : `/${path}`}`;
  }

  isApiUrl(url: string): boolean {
    return url.startsWith(`${this.value.apiBaseUrl}/api`);
  }
}
