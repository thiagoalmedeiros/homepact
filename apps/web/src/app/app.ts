import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { TenantService } from './core/tenant.service';
import { SiteFooter } from './layout/site-footer';
import { SiteNav } from './layout/site-nav';
import { Toasts } from './layout/toasts';
import { ConfirmHost } from './layout/confirm-host';

@Component({
  imports: [RouterOutlet, SiteNav, SiteFooter, Toasts, ConfirmHost],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly tenant = inject(TenantService);
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  constructor() {
    this.showPlaceholderForBrokenImages();
  }

  /** Remote photos can disappear: a broken image is hidden so its placeholder shows instead. */
  private showPlaceholderForBrokenImages(): void {
    document.addEventListener(
      'error',
      (e) => {
        if (e.target instanceof HTMLImageElement) e.target.classList.add('img-failed');
      },
      true,
    );
  }

  /** The company console and platform console bring their own chrome. */
  protected siteChrome(): boolean {
    return !this.tenant.isPlatform() && !this.url().startsWith('/console');
  }
}
