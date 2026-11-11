import { TestBed } from '@angular/core/testing';
import { settle, setup } from '../../testing';
import { PlatformPage } from './platform.page';

describe('PlatformPage', () => {
  it('super-admin companies + origins: lists tenants and creates one with several origins', async () => {
    const http = setup([], { kind: 'platform', name: 'Platform' });
    const fixture = TestBed.createComponent(PlatformPage);
    await settle(fixture);
    http.expectOne('/api/platform/companies').flush([
      {
        id: 'c1',
        name: 'Example Homes',
        slug: 'example-homes',
        logoUrl: 'https://x.test/l.png',
        origins: ['http://localhost:4200'],
        currency: 'CAD',
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('http://localhost:4200');
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('New company'))!
      .click();
    await settle(fixture);
    const fill = (sel: string, value: string) => {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    fill('#c-name', 'Acme Homes');
    fill('#c-slug', 'acme');
    fill('#c-logo', 'https://acme.test/logo.png');
    fill('#c-origins', 'https://acme.test\nhttps://www.acme.test');
    await settle(fixture);
    document.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toMatchObject({
      name: 'Acme Homes',
      slug: 'acme',
      origins: ['https://acme.test', 'https://www.acme.test'],
      currency: 'CAD',
      active: true,
    });
  });

  it('super-admin tax suggestions: lists them, adds one, and adds the missing Canadian ones', async () => {
    const http = setup([], { kind: 'platform', name: 'Platform' });
    const fixture = TestBed.createComponent(PlatformPage);
    await settle(fixture);
    http.expectOne('/api/platform/companies').flush([]);
    const ontario = {
      id: 'tp-on',
      code: 'ON',
      name: 'Ontario',
      components: [{ label: 'HST', ratePercent: 13 }],
      note: 'New homes may qualify for a rebate.',
      createdAt: '',
      updatedAt: '',
    };
    http.expectOne('/api/platform/tax-presets').flush([ontario]);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const row = el.querySelector('[data-testid="preset-ON"]')!;
    expect(row.textContent).toContain('HST 13%');
    expect(row.textContent).toContain('New homes may qualify for a rebate.');

    el.querySelector<HTMLButtonElement>('[data-testid="new-preset"]')!.click();
    await settle(fixture);
    const fill = (sel: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    fill('#tp-name', 'Quebec');
    fill('#tp-code', 'qc');
    fill('[data-testid="tax-component-0"] input:not([type])', 'GST');
    fill('[data-testid="tax-component-0"] input[type="number"]', '5');
    await settle(fixture);
    [...document.querySelectorAll<HTMLButtonElement>('dialog button')]
      .find((b) => b.textContent?.includes('Add a tax'))!
      .click();
    await settle(fixture);
    fill('[data-testid="tax-component-1"] input:not([type])', 'QST');
    fill('[data-testid="tax-component-1"] input[type="number"]', '9.975');
    await settle(fixture);
    document.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit'));
    const created = http.expectOne((r) => r.method === 'POST');
    expect(created.request.url).toBe('/api/platform/tax-presets');
    expect(created.request.body).toEqual({
      code: 'QC',
      name: 'Quebec',
      components: [
        { label: 'GST', ratePercent: 5 },
        { label: 'QST', ratePercent: 9.975 },
      ],
    });
    created.flush({ ...ontario, id: 'tp-qc' });
    await settle(fixture);
    http.expectOne('/api/platform/tax-presets').flush([ontario]);
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('[data-testid="add-starter"]')!.click();
    await settle(fixture);
    const starter = http.expectOne('/api/platform/tax-presets/starter');
    expect(starter.request.method).toBe('POST');
  });
});
