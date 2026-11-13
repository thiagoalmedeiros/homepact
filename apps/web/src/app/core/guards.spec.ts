import { Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { Router, type Routes } from '@angular/router';
import { setup, signInAs } from '../testing';
import { buyerGuard, sellSideGuard, superAdminGuard, teamGuard } from './guards';

const ROUTES: Routes = [
  { path: 'login', children: [] },
  { path: 'proposals', canActivate: [buyerGuard], children: [] },
  { path: 'platform', canActivate: [superAdminGuard], children: [] },
  {
    path: 'console',
    canActivate: [teamGuard],
    children: [
      { path: '', canActivate: [sellSideGuard], children: [] },
      { path: 'proposals', canActivate: [sellSideGuard], children: [] },
      { path: 'catalog', canActivate: [sellSideGuard], children: [] },
      { path: 'payments', children: [] },
      { path: 'agreements', children: [] },
    ],
  },
];

const visit = async (url: string) => {
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  return router.url;
};

describe('role guards', () => {
  it('visitors are asked to sign in, and come back to the page they wanted', async () => {
    setup(ROUTES);
    expect(await visit('/console/payments')).toBe('/login?next=%2Fconsole%2Fpayments');
    expect(await visit('/proposals')).toBe('/login?next=%2Fproposals');
  });

  it('a buyer who opens a console page is taken to their proposals', async () => {
    const http = setup(ROUTES);
    await signInAs(http, Role.Buyer, 'Robin Buyer');
    for (const url of ['/console', '/console/payments', '/console/agreements', '/platform']) {
      expect(await visit(url), url).toBe('/proposals');
    }
  });

  it('sales who open a page that is not theirs are taken to the console overview', async () => {
    const http = setup(ROUTES);
    await signInAs(http, Role.CompanyStaff);
    expect(await visit('/console/payments')).toBe('/console/payments');
    for (const url of ['/proposals', '/platform']) {
      expect(await visit(url), url).toBe('/console');
    }
  });

  it('finance who open a page that is not theirs are taken to the payments to approve', async () => {
    const http = setup(ROUTES);
    await signInAs(http, Role.CompanyFinance, 'Riley Chen');
    expect(await visit('/console/agreements')).toBe('/console/agreements');
    for (const url of ['/console', '/console/proposals', '/console/catalog', '/proposals']) {
      expect(await visit(url), url).toBe('/console/payments');
    }
  });

  it('the platform administrator is kept on the platform console', async () => {
    const http = setup(ROUTES, null);
    await signInAs(http, Role.SuperAdmin, 'Platform Admin');
    expect(await visit('/platform')).toBe('/platform');
    expect(await visit('/console')).toBe('/');
  });
});
