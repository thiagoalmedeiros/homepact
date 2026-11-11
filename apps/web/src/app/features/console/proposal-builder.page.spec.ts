import { HouseStatus, Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import type { ReferralProgram } from '@homepact/shared';
import { settle, setup, signInAs } from '../../testing';
import { HOUSE_DETAIL, pause, taxedQuote, TAX_RATES } from '../../testing-fixtures';
import { ProposalBuilderPage } from './proposal-builder.page';

const PROGRAMS: ReferralProgram[] = [
  {
    id: 'prog-1',
    name: 'Homeowner referral',
    creditCents: 200_000,
    active: true,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'prog-old',
    name: 'Ended promotion',
    creditCents: 900_000,
    active: false,
    createdAt: '',
    updatedAt: '',
  },
];

const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input'));
};

describe('ProposalBuilderPage', () => {
  it('prices with the default province, then the rep picks another one and records a referral', async () => {
    const http = setup();
    await signInAs(http, Role.CompanyStaff);
    const fixture = TestBed.createComponent(ProposalBuilderPage);
    await settle(fixture);
    http
      .expectOne('/api/admin/houses')
      .flush([{ ...HOUSE_DETAIL.house, status: HouseStatus.Published }]);
    http.expectOne('/api/inventory').flush([]);
    http.expectOne('/api/tax-rates').flush(TAX_RATES);
    http.expectOne('/api/referral-programs').flush(PROGRAMS);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const testid = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

    testid('start-plan').click();
    await settle(fixture);
    testid('plan-alder').click();
    await settle(fixture);
    http.expectOne('/api/admin/houses/h1/detail').flush(HOUSE_DETAIL);
    await settle(fixture);
    await pause();
    let quote = http.expectOne('/api/proposals/quote');
    expect(quote.request.body).toEqual({
      houseId: 'h1',
      selections: {},
      adjustments: [],
      taxRegion: 'AB',
    });
    quote.flush(taxedQuote());
    await settle(fixture);
    expect(testid('builder-total').textContent).toContain('$629,475');
    expect(testid('quote-tax').textContent).toContain('Alberta');

    testid('builder-continue').click();
    await settle(fixture);
    const region = testid('tax-region') as HTMLSelectElement;
    expect(region.value).toBe('AB');
    region.value = 'ON';
    region.dispatchEvent(new Event('change'));
    testid('referral-toggle').click();
    await settle(fixture);
    const program = testid('referral-program') as HTMLSelectElement;
    expect([...program.options].map((o) => o.value)).toEqual(['prog-1']);
    const create = testid('create-proposal') as HTMLButtonElement;
    type(el.querySelector<HTMLInputElement>('#b-name')!, 'Riley Buyer');
    await settle(fixture);
    expect(create.disabled).toBe(true);
    type(testid('referrer-name') as HTMLInputElement, 'Dana Whitfield');
    type(el.querySelector<HTMLInputElement>('#tr-email')!, 'dana@example.com');
    await settle(fixture);
    await pause();
    const pending = http.match('/api/proposals/quote');
    for (const stale of pending.slice(0, -1)) stale.flush(taxedQuote());
    quote = pending.at(-1)!;
    expect(quote.request.body).toEqual({
      houseId: 'h1',
      selections: {},
      adjustments: [],
      taxRegion: 'ON',
      referral: { programId: 'prog-1', referrerName: 'Dana Whitfield' },
    });
    quote.flush(taxedQuote());
    await settle(fixture);
    expect(create.disabled).toBe(false);

    create.click();
    await settle(fixture);
    const created = http.expectOne((r) => r.method === 'POST' && r.url === '/api/proposals');
    expect(created.request.body).toEqual({
      houseId: 'h1',
      selections: {},
      adjustments: [],
      taxRegion: 'ON',
      referral: {
        programId: 'prog-1',
        referrerName: 'Dana Whitfield',
        referrerEmail: 'dana@example.com',
      },
      buyer: { name: 'Riley Buyer' },
    });
  });
});
