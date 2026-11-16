import { AgreementStatus, PaymentStatus, ProposalStatus, Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { settle, setup, signInAs } from '../../testing';
import { payment, proposalDetail, SALES } from '../../testing-fixtures';
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

  it('the signed value counts each sale at its price now, change orders included', async () => {
    const http = setup();
    await signInAs(http, Role.CompanyStaff, 'Jordan Blake');
    const fixture = TestBed.createComponent(OverviewPage);
    await settle(fixture);
    const signed = (id: string, totalCents: number) => ({
      ...proposalDetail().proposal,
      id,
      status: ProposalStatus.Signed,
      signature: { fullName: 'Robin Buyer', revision: 1, totalCents, signedAt: '2026-10-30' },
    });
    http.expectOne('/api/proposals').flush([signed('p1', 60_000_000), signed('p2', 50_000_000)]);
    http.expectOne('/api/inventory').flush([]);
    http.expectOne('/api/agreements').flush([
      { id: 'a1', proposalId: 'p1', status: AgreementStatus.Executed, totalCents: 63_000_000 },
      { id: 'a0', proposalId: 'p2', status: AgreementStatus.Cancelled, totalCents: 1 },
    ]);
    await settle(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="signed-value"]')
        ?.textContent,
    ).toContain('$1,130,000');
  });
});
