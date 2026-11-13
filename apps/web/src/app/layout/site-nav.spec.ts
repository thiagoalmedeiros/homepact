import { TestBed } from '@angular/core/testing';
import { TenantService } from '../core/tenant.service';
import { Role } from '@homepact/shared/enums';
import { settle, setup, signInAs } from '../testing';
import { SiteNav } from './site-nav';

describe('SiteNav', () => {
  it('header renders tenant logo from GET /api/tenant', async () => {
    const http = setup([], null);
    const tenant = TestBed.inject(TenantService);
    const loading = tenant.load();
    http.expectOne('/api/tenant').flush({
      kind: 'company',
      name: 'Example Homes',
      logoUrl: 'https://cdn.test/s.png',
      currency: 'CAD',
    });
    await loading;
    const fixture = TestBed.createComponent(SiteNav);
    await settle(fixture);
    const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>(
      '[data-testid="tenant-logo"]',
    );
    expect(img?.getAttribute('src')).toBe('https://cdn.test/s.png');
    expect(img?.alt).toBe('Example Homes');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows the company name when the logo fails to load', async () => {
    setup();
    const fixture = TestBed.createComponent(SiteNav);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('img')!.dispatchEvent(new Event('error'));
    await settle(fixture);
    expect(el.textContent).toContain('Example Homes');
    expect(el.querySelector('img')).toBeNull();
  });

  it('finance finds the way back to their console from the site', async () => {
    const http = setup();
    await signInAs(http, Role.CompanyFinance, 'Riley Chen');
    const fixture = TestBed.createComponent(SiteNav);
    await settle(fixture);
    const link = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === 'Console',
    );
    expect(link?.getAttribute('href')).toBe('/console/payments');
  });
});
