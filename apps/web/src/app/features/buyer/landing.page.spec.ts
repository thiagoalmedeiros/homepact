import { Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { settle, setup, signInAs } from '../../testing';
import { keyFromInvite, LandingPage } from './landing.page';

describe('keyFromInvite', () => {
  it('accepts a full invite link or the bare key', () => {
    const key = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    expect(keyFromInvite(`https://homes.test/k?key=${key}`)).toBe(key);
    expect(keyFromInvite(`  ${key} `)).toBe(key);
    expect(keyFromInvite('hello')).toBeNull();
    expect(keyFromInvite('')).toBeNull();
  });
});

describe('LandingPage', () => {
  it('someone from finance opening the site goes to the payments waiting for approval', async () => {
    const http = setup([{ path: 'console/payments', children: [] }]);
    await signInAs(http, Role.CompanyFinance, 'Riley Chen');
    const fixture = TestBed.createComponent(LandingPage);
    await settle(fixture);
    expect(TestBed.inject(Router).url).toBe('/console/payments');
  });
});
