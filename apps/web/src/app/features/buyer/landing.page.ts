import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { TenantService } from '../../core/tenant.service';
import { Icon } from '../../shared/icon';

const keyParamOf = (link: string): string | null => {
  try {
    return new URL(link).searchParams.get('key');
  } catch {
    return null;
  }
};

/** Extracts the key from a pasted invite link, or accepts the bare key. */
export const keyFromInvite = (text: string): string | null => {
  const value = text.trim();
  if (!value) return null;
  return keyParamOf(value) ?? (/^[\w-]{20,}$/.test(value) ? value : null);
};

/** The small front door: buyers arrive by invite link. */
@Component({
  selector: 'hc-landing',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
})
export class LandingPage implements OnInit {
  protected readonly tenant = inject(TenantService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected invite = '';
  protected invalid = false;
  protected readonly paths = PATHS;
  protected readonly steps: { icon: string; title: string; body: string }[] = [
    {
      icon: 'eye',
      title: $localize`:@@landing.steps.review.title:Review`,
      body: $localize`:@@landing.steps.review.body:See exactly what is included and what it costs, line by line.`,
    },
    {
      icon: 'edit',
      title: $localize`:@@landing.steps.adjust.title:Adjust`,
      body: $localize`:@@landing.steps.adjust.body:Remove options or switch packages. Each change is reviewed and answered.`,
    },
    {
      icon: 'check',
      title: $localize`:@@landing.steps.sign.title:Sign`,
      body: $localize`:@@landing.steps.sign.body:When the proposal is right, sign it here and keep a printable copy.`,
    },
  ];

  ngOnInit(): void {
    if (this.auth.isTeam() || this.auth.isBuyer())
      void this.router.navigateByUrl(this.auth.home(), { replaceUrl: true });
  }

  protected open(): void {
    const key = keyFromInvite(this.invite);
    this.invalid = !key;
    if (key) void this.router.navigate([PATHS.invite], { queryParams: { key } });
  }
}
