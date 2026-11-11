import { ChangeDetectionStrategy, Component, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AgreementTemplate } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';

@Component({
  selector: 'hc-console-agreement-templates',
  imports: [RouterLink, LoadState, RelativeTimePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement-templates.page.html',
  styleUrl: './agreement-templates.page.scss',
})
export class AgreementTemplatesPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly paths = PATHS;
  protected readonly templates = resource({
    loader: () => this.api.get<AgreementTemplate[]>(API.agreementTemplates.list),
  });

  protected isAdmin(): boolean {
    return this.auth.isAdmin();
  }
}
