import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { PATHS } from './app-paths';
import { AuthService } from './auth.service';
import { TenantService } from './tenant.service';

export const isPlatformOrigin: CanMatchFn = () => inject(TenantService).isPlatform();
export const isCompanyOrigin: CanMatchFn = () => !inject(TenantService).isPlatform();

/** Lets the right people in; someone signed in goes to their own home, a visitor to sign in. */
const requireRole =
  (check: (auth: AuthService) => boolean): CanActivateFn =>
  (_route, state) => {
    const auth = inject(AuthService);
    if (check(auth)) return true;
    const router = inject(Router);
    if (auth.user()) return router.parseUrl(auth.home());
    return router.createUrlTree([PATHS.login], { queryParams: { next: state.url } });
  };

export const teamGuard = requireRole((a) => a.isTeam());
export const sellSideGuard = requireRole((a) => a.isStaff());
export const buyerGuard = requireRole((a) => a.isBuyer());
export const superAdminGuard = requireRole((a) => a.isSuperAdmin());
