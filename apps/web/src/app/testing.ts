import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Routes } from '@angular/router';
import type { Role, TenantBranding } from '@homepact/shared';
import { authInterceptor } from './core/auth.interceptor';
import { AuthService } from './core/auth.service';
import { TenantService } from './core/tenant.service';

export const COMPANY: TenantBranding = {
  kind: 'company',
  name: 'Example Homes',
  logoUrl: 'https://cdn.test/example-homes.svg',
  currency: 'CAD',
};

const availableStorages = (): Storage[] => {
  try {
    return [localStorage, sessionStorage];
  } catch {
    return [];
  }
};

/** Shared TestBed setup: real interceptor, mocked HTTP backend, company tenant loaded. */
export const setup = (routes: Routes = [], branding: TenantBranding | null = COMPANY) => {
  for (const storage of availableStorages()) storage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter(routes),
    ],
  });
  if (branding) TestBed.inject(TenantService).branding.set(branding);
  return TestBed.inject(HttpTestingController);
};

/** Lets signals, resources and pending promises settle. */
export const settle = async (fixture?: { detectChanges(): void }) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    fixture?.detectChanges();
  }
};

/** Signs in through the real AuthService, answering the login call. */
export const signInAs = async (http: HttpTestingController, role: Role, name = 'Jordan Blake') => {
  const login = TestBed.inject(AuthService).login({ email: 'me@x.test', password: 'pw' });
  http.expectOne('/api/auth/login').flush({
    accessToken: 'a',
    refreshToken: 'r',
    expiresIn: 900,
    user: {
      id: 'me',
      email: 'me@x.test',
      name,
      role,
      companyId: 'c',
      active: true,
      createdAt: '',
    },
  });
  await login;
};
