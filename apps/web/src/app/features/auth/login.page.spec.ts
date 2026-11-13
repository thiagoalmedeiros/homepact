import { Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { settle, setup } from '../../testing';
import { LoginPage, safeNext } from './login.page';

describe('LoginPage', () => {
  it('login/register forms submit and store tokens', async () => {
    const http = setup([{ path: 'console', children: [] }]);
    const fixture = TestBed.createComponent(LoginPage);
    const router = TestBed.inject(Router);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const type = (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('#email', 'jordan@example-homes.demo');
    type('#password', 'Showcase2026!');
    await settle(fixture);
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({
      email: 'jordan@example-homes.demo',
      password: 'Showcase2026!',
    });
    req.flush({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
      user: {
        id: 'u',
        email: 'jordan@example-homes.demo',
        name: 'Jordan',
        role: Role.CompanyStaff,
        companyId: 'c',
        active: true,
        createdAt: '',
      },
    });
    await settle(fixture);
    expect(TestBed.inject(AuthService).isStaff()).toBe(true);
    expect(JSON.parse(localStorage.getItem('hc.session')!).tokens.refreshToken).toBe('r');
    expect(router.url).toBe('/console');
  });

  it('finance signs in and lands on the payments waiting for approval', async () => {
    const http = setup([{ path: 'console/payments', children: [] }]);
    const fixture = TestBed.createComponent(LoginPage);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    for (const [sel, value] of [
      ['#email', 'riley@example-homes.demo'],
      ['#password', 'Showcase2026!'],
    ] as const) {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/auth/login').flush({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
      user: {
        id: 'f',
        email: 'riley@example-homes.demo',
        name: 'Riley Chen',
        role: Role.CompanyFinance,
        companyId: 'c',
        active: true,
        createdAt: '',
      },
    });
    await settle(fixture);
    expect(TestBed.inject(Router).url).toBe('/console/payments');
  });

  it('shows the error message on bad credentials', async () => {
    const http = setup();
    const fixture = TestBed.createComponent(LoginPage);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    for (const [sel, value] of [
      ['#email', 'a@b.test'],
      ['#password', 'wrong'],
    ] as const) {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http
      .expectOne('/api/auth/login')
      .flush({ error: 'Incorrect email or password' }, { status: 401, statusText: 'x' });
    await settle(fixture);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Incorrect email or password',
    );
  });

  it('only follows same-site redirects', () => {
    expect(safeNext('/account', '/')).toBe('/account');
    expect(safeNext('//evil.test', '/')).toBe('/');
    expect(safeNext('https://evil.test', '/')).toBe('/');
  });
});
