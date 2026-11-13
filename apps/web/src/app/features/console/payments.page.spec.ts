import { PaymentStatus } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import type { PaymentActor } from '@homepact/shared';
import { settle, setup, signInAs } from '../../testing';
import { FINANCE, payment, SALES } from '../../testing-fixtures';
import { PaymentsPage } from './payments.page';

const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);
const waiting = [
  payment({
    id: 'pay-2',
    reference: 'PAY-BBBB-0002',
    status: PaymentStatus.Pending,
    amountCents: 3_000_000,
    recordedBy: SALES,
  }),
  payment({
    id: 'pay-3',
    reference: 'PAY-CCCC-0003',
    agreementId: 'a2',
    agreementReference: 'A-2002',
    status: PaymentStatus.Pending,
    amountCents: 500_000,
    recordedBy: SALES,
  }),
];

const mount = async (who: PaymentActor, entries = waiting) => {
  const http = setup();
  await signInAs(http, who.role, who.name, who.id);
  const fixture = TestBed.createComponent(PaymentsPage);
  await settle(fixture);
  http.expectOne('/api/agreement-payments?status=pending').flush(entries);
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};

describe('PaymentsPage', () => {
  it('finance works through the payments waiting for approval until none is left', async () => {
    const { http, fixture, el } = await mount(FINANCE);
    const first = byTestId(el, 'queue-pay-2')!;
    expect(first.textContent).toContain('$30,000');
    expect(first.textContent).toContain('Jordan Blake');
    expect(first.querySelector('a')?.getAttribute('href')).toBe('/console/agreements/a1');

    byTestId(el, 'approve-pay-2')!.click();
    await settle(fixture);
    http.expectOne('/api/agreements/a1/payments/pay-2/approve').flush({});
    await settle(fixture);
    http.expectOne('/api/agreement-payments?status=pending').flush([waiting[1]]);
    await settle(fixture);
    expect(byTestId(el, 'queue-pay-2')).toBeNull();

    byTestId(el, 'reject-pay-3')!.click();
    await settle(fixture);
    const reason = byTestId<HTMLInputElement>(document, 'reason')!;
    reason.value = 'No cheque at the sales office';
    reason.dispatchEvent(new Event('input'));
    await settle(fixture);
    byTestId(document, 'reason-submit')!.click();
    await settle(fixture);
    const reject = http.expectOne('/api/agreements/a2/payments/pay-3/reject');
    expect(reject.request.body).toEqual({ reason: 'No cheque at the sales office' });
    reject.flush({});
    await settle(fixture);
    http.expectOne('/api/agreement-payments?status=pending').flush([]);
    await settle(fixture);
    expect(byTestId(el, 'queue-empty')?.textContent).toContain('Nothing is waiting');
  });

  it('sales follow what they recorded, and read why finance rejected an entry', async () => {
    const { http, fixture, el } = await mount(SALES, [waiting[0]!]);
    expect(byTestId(el, 'queue-pay-2')?.textContent).toContain('Waiting for approval');
    expect(byTestId(el, 'approve-pay-2')).toBeNull();
    expect(byTestId(el, 'reject-pay-2')).toBeNull();

    [...el.querySelectorAll<HTMLButtonElement>('.filters button')]
      .find((b) => b.textContent?.includes('Rejected'))!
      .click();
    await settle(fixture);
    http.expectOne('/api/agreement-payments?status=rejected').flush([
      {
        ...waiting[1],
        status: PaymentStatus.Rejected,
        reviewedBy: FINANCE,
        rejectReason: 'No cheque at the sales office',
      },
    ]);
    await settle(fixture);
    expect(byTestId(el, 'queue-pay-3')?.textContent).toContain('No cheque at the sales office');
  });
});
