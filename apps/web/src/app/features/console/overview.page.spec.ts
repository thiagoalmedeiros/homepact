import { PaymentStatus, Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { settle, setup, signInAs } from '../../testing';
import { payment, SALES } from '../../testing-fixtures';
import { OverviewPage } from './overview.page';

const open = async (role: Role) => {
  const http = setup();
  await signInAs(http, role, 'Morgan Reyes');
  const fixture = TestBed.createComponent(OverviewPage);
  await settle(fixture);
  http.expectOne('/api/proposals').flush([]);
  http.expectOne('/api/inventory').flush([]);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};

describe('OverviewPage', () => {
  it('an administrator sees how many payments wait for approval, and goes to them', async () => {
    const { http, fixture, el } = await open(Role.CompanyAdmin);
    http
      .expectOne('/api/agreement-payments?status=pending')
      .flush([
        payment({ status: PaymentStatus.Pending, recordedBy: SALES }),
        payment({ id: 'pay-2', status: PaymentStatus.Pending, recordedBy: SALES }),
      ]);
    await settle(fixture);
    const card = el.querySelector<HTMLAnchorElement>('[data-testid="payments-waiting"]')!;
    expect(card.textContent).toContain('Payments to approve');
    expect(card.textContent).toContain('2');
    expect(card.getAttribute('href')).toBe('/console/payments');
  });

  it('sales are not asked to approve payments', async () => {
    const { http, el } = await open(Role.CompanyStaff);
    http.expectNone('/api/agreement-payments?status=pending');
    expect(el.querySelector('[data-testid="payments-waiting"]')).toBeNull();
  });
});
