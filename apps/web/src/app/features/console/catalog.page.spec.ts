import { TestBed } from '@angular/core/testing';
import { settle, setup } from '../../testing';
import { CatalogPage } from './catalog.page';

const catalog = {
  areas: [{ slug: 'kitchen', label: 'Kitchen', order: 0 }],
  items: [{ id: 'i1', areaSlug: 'kitchen', name: 'Quartz', priceCents: 690_000 }],
  packages: [],
};

describe('CatalogPage', () => {
  it('catalog editor CRUD: lists options and creates one in integer cents', async () => {
    const http = setup();
    const fixture = TestBed.createComponent(CatalogPage);
    await settle(fixture);
    http.expectOne('/api/catalog').flush(catalog);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Quartz');
    expect(el.textContent).toContain('$6,900');

    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Add option'))!
      .click();
    await settle(fixture);
    const name = document.querySelector<HTMLInputElement>('#i-name')!;
    name.value = 'Island';
    name.dispatchEvent(new Event('input'));
    const price = document.querySelector<HTMLInputElement>('#i-price')!;
    price.value = '3000.5';
    price.dispatchEvent(new Event('input'));
    await settle(fixture);
    document.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/catalog/items');
    expect(req.request.body).toEqual({
      areaSlug: 'kitchen',
      name: 'Island',
      priceCents: 300_050,
      soldSeparately: true,
    });
    req.flush({ id: 'i2' });
    await settle(fixture);
    http.expectOne('/api/catalog').flush(catalog);
  });
});
