import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { PATHS } from './app-paths';
import { AuthService } from './auth.service';
import { TenantService } from './tenant.service';

export const isPlatformOrigin: CanMatchFn = () => inject(TenantService).isPlatform();
export const isCompanyOrigin: CanMatchFn = () => !inject(TenantService).isPlatform();

const requireRole =
  (check: (auth: AuthService) => boolean, loginPath: string): CanActivateFn =>
  (_route, state) => {
    const auth = inject(AuthService);
    if (check(auth)) return true;
    return inject(Router).createUrlTree([loginPath], { queryParams: { next: state.url } });
  };

export const staffGuard = requireRole((a) => a.isStaff(), PATHS.login);
export const buyerGuard = requireRole((a) => a.isBuyer(), PATHS.login);
export const superAdminGuard = requireRole((a) => a.isSuperAdmin(), PATHS.login);
