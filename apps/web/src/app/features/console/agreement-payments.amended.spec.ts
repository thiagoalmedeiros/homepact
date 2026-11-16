import { PaymentKind, PaymentMethod, Role } from '@homepact/shared/enums';
import type { Agreement, AgreementLedger, AgreementPayment } from '@homepact/shared';
import { paymentSchedule } from '@homepact/shared/payment-schedule';
import { TestBed } from '@angular/core/testing';
import { settle, setup, signInAs } from '../../testing';
import { executedAgreement, FINANCE, payment } from '../../testing-fixtures';
import { AgreementPage } from './agreement.page';

const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);
const type = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input'));
};

const AGREEMENT = executedAgreement();
const SIGNED_TOTAL = AGREEMENT.quote.totalCents; // $629,475

/** The ledger the API returns once change order 1 moved the price to `totalCents`, with an
 * upgrade instalment due November 1 and closing moved to June 30. */
const amendedLedger = (totalCents: number, entries: AgreementPayment[]): AgreementLedger => ({
  agreementId: 'a1',
  agreementReference: 'A-2001',
  agreementStatus: AGREEMENT.status,
  currency: 'CAD',
  schedule: paymentSchedule(
    {
      deposits: [
        ...AGREEMENT.terms.deposits,
        { label: 'Upgrade payment', amountCents: 500_000, dueDate: '2026-11-01' },
      ],
      closingDate: '2027-06-30',
      totalCents,
    },
    entries,
    '2026-11-15',
  ),
  payments: entries,
  priceChanges: [
    {
      number: 1,
      reference: 'CO-AAAA-0001',
      executedAt: '2026-11-12T10:00:00.000Z',
      fromCents: SIGNED_TOTAL,
      toCents: totalCents,
    },
  ],
});

const mount = async (ledger: AgreementLedger, body: Agreement = AGREEMENT) => {
  const http = setup();
  await signInAs(http, Role.CompanyFinance, FINANCE.name, FINANCE.id);
  const fixture = TestBed.createComponent(AgreementPage);
  fixture.componentRef.setInput('id', 'a1');
  await settle(fixture);
  http.expectOne('/api/agreements/a1').flush(body);
  await settle(fixture);
  http.expectOne('/api/agreements/a1/payments').flush(ledger);
  http.expectOne('/api/agreements/a1/amendments').flush([]);
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};

describe('AgreementPage (payments after a change order)', () => {
  it('the ledger follows the amended price, instalments and closing date, and says why', async () => {
    const { el } = await mount(amendedLedger(63_892_500, [payment({ amountCents: 3_000_000 })]));
    expect(byTestId(el, 'payments-received')?.textContent).toContain(
      'Received $30,000 of $638,925',
    );
    expect(byTestId(el, 'payments-received')?.textContent).toContain('outstanding $608,925');
    expect(byTestId(el, 'payments-overdue')?.textContent).toContain('$5,000 overdue');
    expect(byTestId(el, 'schedule-line-1')?.textContent).toContain('Upgrade payment');
    expect(byTestId(el, 'schedule-line-1')?.textContent).toContain('Overdue');
    expect(byTestId(el, 'schedule-line-2')?.textContent).toContain('June 30, 2027');
    const history = byTestId(el, 'price-changes')!;
    expect(history.textContent).toContain('Signed at $629,475');
    expect(history.textContent).toContain('Change order 1 (CO-AAAA-0001)');
    expect(history.textContent).toContain('$638,925');
    expect(byTestId(el, 'payments-credit')).toBeNull();
  });

  it('a price cut below what was received shows as a credit, which finance refunds', async () => {
    const received = payment({ amountCents: SIGNED_TOTAL });
    const { http, fixture, el } = await mount(amendedLedger(60_000_000, [received]));
    expect(byTestId(el, 'payments-received')?.textContent).toContain('outstanding $0');
    expect(byTestId(el, 'payments-credit')?.textContent).toContain(
      '$29,475 received above the price is owed back to the buyer',
    );
    expect(byTestId(el, 'payments-overdue')).toBeNull();
    expect(byTestId(el, 'record-payment')).toBeNull();

    byTestId(el, 'refund-credit')!.click();
    await settle(fixture);
    await fixture.whenStable();
    await settle(fixture);
    expect(Number(byTestId<HTMLInputElement>(document, 'payment-amount')!.value)).toBe(29_475);
    type(byTestId<HTMLInputElement>(document, 'payment-date')!, '2026-11-14');
    type(byTestId<HTMLSelectElement>(document, 'payment-method')!, PaymentMethod.Wire);
    await settle(fixture);
    byTestId(document, 'payment-submit')!.click();
    await settle(fixture);
    const req = http.expectOne('/api/agreements/a1/payments');
    expect(req.request.body).toEqual({
      kind: PaymentKind.Refund,
      amountCents: 2_947_500,
      receivedOn: '2026-11-14',
      method: PaymentMethod.Wire,
    });
  });
});
