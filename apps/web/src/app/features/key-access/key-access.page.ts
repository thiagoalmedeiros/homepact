import { AccessResourceType } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AccessSession } from '@homepact/shared';
import { ApiRequestError } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';

export const destinationOf = (s: Pick<AccessSession, 'resourceType' | 'resourceId'>): string[] =>
  s.resourceType === AccessResourceType.Agreement
    ? PATHS.agreement(s.resourceId)
    : PATHS.proposal(s.resourceId);

/** Exchanges a private link (`/k?key=…`) for a guest session; a signing link also needs its
 * code. */
@Component({
  selector: 'hc-key-access',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './key-access.page.html',
  styleUrl: './key-access.page.scss',
})
export class KeyAccessPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly paths = PATHS;
  protected readonly state = signal<'working' | 'code' | 'claim' | 'error'>('working');
  protected readonly error = signal('');
  protected readonly codeError = signal('');
  protected code = '';
  private key = '';
  private session: AccessSession | null = null;

  async ngOnInit(): Promise<void> {
    this.key = this.route.snapshot.queryParamMap.get('key') ?? '';
    this.removeKeyFromAddressBar();
    if (!this.key) {
      this.fail($localize`:@@errors.linkMissingKey:The link is missing its key.`);
      return;
    }
    await this.open();
  }

  /** The key leaves the address bar first, so it never reaches history, analytics or referrers. */
  private removeKeyFromAddressBar(): void {
    history.replaceState(history.state, '', PATHS.invite);
  }

  /** Opens the link; a link that needs a code comes back as 422 and asks for one. */
  private async open(code?: string): Promise<void> {
    try {
      this.session = await this.auth.openWithKey(this.key, code);
      if (this.auth.isBuyer() && this.session.resourceType === AccessResourceType.Proposal) {
        this.state.set('claim');
      } else {
        this.view();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : $localize`:@@errors.invalidLink:Invalid link`;
      const status = err instanceof ApiRequestError ? err.status : 0;
      if (status === 422 || (code && status === 404)) {
        this.codeError.set(code ? message : '');
        this.state.set('code');
      } else {
        this.fail(message);
      }
    }
  }

  protected readonly busy = signal(false);

  protected async submitCode(): Promise<void> {
    const code = this.code.trim();
    if (this.busy() || code.length < 4) return;
    this.busy.set(true);
    try {
      await this.open(code);
    } finally {
      this.busy.set(false);
    }
  }

  protected view(): void {
    if (this.session) void this.router.navigate(destinationOf(this.session), { replaceUrl: true });
  }

  protected async claim(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const res = await this.auth.claim(this.key);
      this.toast.success($localize`:@@keyAccess.added:Added to your account`);
      void this.router.navigate(destinationOf(res), { replaceUrl: true });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.state.set('error');
  }
}
