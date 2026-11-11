import { Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { setup } from '../testing';
import { AuthService } from './auth.service';
import { staffGuard } from './guards';

describe('role guards', () => {
  it('role-based route guards send visitors to sign in', async () => {
    const http = setup([
      { path: 'login', children: [] },
      { path: 'console', canActivate: [staffGuard], children: [] },
    ]);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/console');
    expect(router.url).toBe('/login?next=%2Fconsole');

    const login = TestBed.inject(AuthService).login({ email: 's@x.test', password: 'pw' });
    http.expectOne('/api/auth/login').flush({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
      user: {
        id: 'u',
        email: 's@x.test',
        name: 'S',
        role: Role.CompanyStaff,
        companyId: 'c',
        active: true,
        createdAt: '',
      },
    });
    await login;
    await router.navigateByUrl('/console');
    expect(router.url).toBe('/console');
  });
});
