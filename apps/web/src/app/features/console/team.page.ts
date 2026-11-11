import { Role } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AuthUser, UserCreate } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { Sheet } from '../../shared/sheet';

@Component({
  selector: 'hc-console-team',
  imports: [LoadState, FormsModule, Sheet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './team.page.html',
  styleUrl: './team.page.scss',
})
export class TeamPage {
  protected readonly Role = Role;
  protected activeLabel(name: string): string {
    return $localize`:@@console.team.activeLabel:Active ${name}:name:`;
  }

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly auth = inject(AuthService);
  protected readonly users = resource({ loader: () => this.api.get<AuthUser[]>(API.users.list) });
  protected readonly adding = signal(false);
  protected readonly busy = signal(false);
  protected draft: UserCreate = { name: '', email: '', password: '', role: Role.CompanyStaff };

  protected readonly roleLabel: Record<Role, string> = {
    [Role.CompanyAdmin]: $localize`:@@console.team.roles.company_admin:Administrator`,
    [Role.CompanyStaff]: $localize`:@@console.team.roles.company_staff:Sales`,
    [Role.Buyer]: '',
    [Role.SuperAdmin]: '',
  };

  protected isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  protected open(): void {
    this.draft = { name: '', email: '', password: '', role: Role.CompanyStaff };
    this.adding.set(true);
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.post(API.users.list, this.draft);
      this.toast.success($localize`:@@console.team.added:${this.draft.name}:name: added`);
      this.adding.set(false);
      this.users.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(u: AuthUser): Promise<void> {
    if (this.busy()) return;
    if (
      u.active &&
      !(await this.confirm.ask({
        title: $localize`:@@console.team.confirmDeactivate.title:Deactivate ${u.name}:name:?`,
        message: $localize`:@@console.team.confirmDeactivate.message:They can no longer sign in to the console.`,
        confirmLabel: $localize`:@@console.team.confirmDeactivate.confirm:Deactivate`,
        destructive: true,
      }))
    ) {
      this.users.reload();
      return;
    }
    this.busy.set(true);
    try {
      await this.api.patch(API.users.one(u.id), { active: !u.active });
      this.users.reload();
    } catch (err) {
      this.toast.error(err);
      this.users.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
