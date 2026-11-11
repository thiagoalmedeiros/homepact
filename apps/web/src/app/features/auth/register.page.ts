import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiRequestError } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { TenantService } from '../../core/tenant.service';
import { safeNext } from './login.page';

@Component({
  selector: 'hc-register',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register.page.html',
  styleUrl: './register.page.scss',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly tenant = inject(TenantService);
  protected readonly paths = PATHS;
  private readonly next = inject(ActivatedRoute).snapshot.queryParamMap.get('next');
  protected name = '';
  protected email = '';
  protected phone = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly details = signal<Record<string, string[]>>({});

  protected fieldError(field: string): string | null {
    return this.details()[field]?.[0] ?? null;
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.details.set({});
    try {
      await this.auth.register({
        name: this.name,
        email: this.email,
        password: this.password,
        ...(this.phone.trim() && { phone: this.phone.trim() }),
      });
      void this.router.navigateByUrl(safeNext(this.next, PATHS.myProposals));
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : $localize`:@@errors.registrationFailed:Registration failed`,
      );
      if (err instanceof ApiRequestError && err.details) this.details.set(err.details);
    } finally {
      this.busy.set(false);
    }
  }
}
