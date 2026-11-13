import { AgreementStatus, Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import type { AgreementSummary } from '@homepact/shared';
import { settle, setup, signInAs } from '../../testing';
import { AgreementsPage } from './agreements.page';

const summary = (overrides: Partial<AgreementSummary> = {}): AgreementSummary => ({
  id: 'a1',
  reference: 'A-2001',
  status: AgreementStatus.Executed,
  proposalId: 'p1',
  proposalReference: 'P-1001',
  buyerName: 'Robin Buyer',
  houseName: 'Alder',
  totalCents: 60_650_000,
  currency: 'CAD',
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-04T12:00:00.000Z',
  signedCount: 1,
  purchaserCount: 1,
  ...overrides,
});
const row = (el: HTMLElement, reference: string) =>
  el.querySelector(`[data-testid="agreement-row-${reference}"]`)?.textContent ?? '';

describe('AgreementsPage', () => {
  it('shows what each agreement has received, what is overdue and what awaits approval', async () => {
    const http = setup();
    await signInAs(http, Role.CompanyStaff);
    const fixture = TestBed.createComponent(AgreementsPage);
    await settle(fixture);
    http.expectOne('/api/agreements').flush([
      summary({
        payments: {
          netPaidCents: 1_000_000,
          outstandingCents: 59_650_000,
          overdueCents: 2_000_000,
          pendingCount: 1,
        },
      }),
      summary({ id: 'a2', reference: 'A-2002', status: AgreementStatus.Draft }),
    ]);
    http.expectOne('/api/proposals?status=signed').flush([]);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(row(el, 'A-2001')).toContain('$10,000 received');
    expect(row(el, 'A-2001')).toContain('$20,000 overdue');
    expect(row(el, 'A-2001')).toContain('1 waiting for approval');
    expect(row(el, 'A-2002')).not.toContain('received');
  });

  it('finance sees the agreements without the sell-side shortcuts', async () => {
    const http = setup();
    await signInAs(http, Role.CompanyFinance, 'Riley Chen');
    const fixture = TestBed.createComponent(AgreementsPage);
    await settle(fixture);
    http.expectOne('/api/agreements').flush([summary()]);
    await settle(fixture);
    http.expectNone('/api/proposals?status=signed');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="templates"]')).toBeNull();
    expect(row(el, 'A-2001')).toContain('Robin Buyer');
  });
});
