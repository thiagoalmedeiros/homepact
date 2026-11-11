import { Party } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Proposal } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { turnOf } from '../../shared/status';

@Component({
  selector: 'hc-my-proposals',
  imports: [RouterLink, LoadState, MoneyPipe, RelativeTimePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-proposals.page.html',
  styleUrl: './my-proposals.page.scss',
})
export class MyProposalsPage {
  protected readonly Party = Party;
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly paths = PATHS;
  protected readonly turnOf = turnOf;
  protected readonly list = resource({
    loader: () => this.api.get<Proposal[]>(API.proposals.list),
  });
  protected readonly pending = signal(this.auth.pendingKey());
  protected readonly busy = signal(false);

  protected async claim(): Promise<void> {
    const key = this.pending();
    if (!key || this.busy()) return;
    this.busy.set(true);
    try {
      await this.auth.claim(key);
      this.pending.set(null);
      this.toast.success($localize`:@@myProposals.added:Added to your account`);
      this.list.reload();
    } catch (err) {
      this.toast.error(err);
      this.pending.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    location.assign(PATHS.home);
  }
}
