import { Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth.service';
import { settle, setup } from '../../testing';
import { TeamPage } from './team.page';

describe('TeamPage', () => {
  it('staff management: an administrator adds a sales member', async () => {
    const http = setup();
    const login = TestBed.inject(AuthService).login({ email: 'a@x.test', password: 'pw' });
    http.expectOne('/api/auth/login').flush({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
      user: {
        id: 'u1',
        email: 'a@x.test',
        name: 'Ada',
        role: Role.CompanyAdmin,
        companyId: 'c',
        active: true,
        createdAt: '',
      },
    });
    await login;
    const fixture = TestBed.createComponent(TeamPage);
    await settle(fixture);
    http.expectOne('/api/users').flush([
      {
        id: 'u1',
        email: 'a@x.test',
        name: 'Ada',
        role: Role.CompanyAdmin,
        companyId: 'c',
        active: true,
        createdAt: '',
      },
    ]);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Administrator');
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Add member'))!
      .click();
    await settle(fixture);
    for (const [sel, value] of [
      ['#t-name', 'Sam'],
      ['#t-email', 'sam@x.test'],
      ['#t-pw', 'temporary-pw'],
    ] as const) {
      const input = document.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    document.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/users');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'Sam',
      email: 'sam@x.test',
      password: 'temporary-pw',
      role: Role.CompanyStaff,
    });
  });
});
