import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { TenantService } from '../../core/tenant.service';
import { Icon } from '../../shared/icon';
import { Logo } from '../../shared/logo';

/** Only same-site, path-only redirects are honoured. */
export const safeNext = (next: string | null | undefined, fallback: string): string =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;

@Component({
  selector: 'hc-login',
  imports: [FormsModule, RouterLink, Icon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly tenant = inject(TenantService);
  protected readonly paths = PATHS;
  protected readonly next = signal(inject(ActivatedRoute).snapshot.queryParamMap.get('next'));
  protected email = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login({ email: this.email, password: this.password });
      void this.router.navigateByUrl(safeNext(this.next(), this.auth.home()));
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : $localize`:@@errors.signInFailed:Sign in failed`,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
