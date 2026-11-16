import { AmendmentStatus, PaymentKind, PaymentStatus, Role } from '@homepact/shared/enums';
import type { AgreementCurrent, Amendment, BuyerLedger } from '@homepact/shared';
import { agreementState } from '@homepact/shared/agreement-state';
import { paymentSchedule } from '@homepact/shared/payment-schedule';
import { TestBed } from '@angular/core/testing';
import { ConfirmService } from '../../core/confirm.service';
import { settle, setup, signInAs } from '../../testing';
import {
  amendment,
  buyerLedgerOf,
  executedAgreement,
  HOUSE_DETAIL,
  pause,
  pricedAmendment,
  taxedQuote,
} from '../../testing-fixtures';
import { AgreementRoomPage } from './agreement-room.page';

const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input'));
};

const AGREEMENT = executedAgreement();
const current = (over: Partial<AgreementCurrent> = {}): AgreementCurrent => ({
  state: agreementState(AGREEMENT),
  selections: { kitchen: { packageId: 'chef' } },
  ...over,
});

/** The buyer, signed in, on their executed agreement with these change orders. */
const mount = async (
  orders: Amendment[] = [],
  now: AgreementCurrent = current(),
  ledger: BuyerLedger = buyerLedgerOf(AGREEMENT),
) => {
  const http = setup();
  await signInAs(http, Role.Buyer, 'Robin Buyer');
  const fixture = TestBed.createComponent(AgreementRoomPage);
  fixture.componentRef.setInput('id', 'a1');
  await settle(fixture);
  http.expectOne('/api/agreements/a1').flush(AGREEMENT);
  await settle(fixture);
  http.expectOne('/api/agreements/a1/payments').flush(ledger);
  http.expectOne('/api/agreements/a1/amendments').flush(orders);
  http.expectOne('/api/agreements/a1/amendments/current').flush(now);
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};

/** Opens the request sheet and answers the catalog it asks for. */
const openRequest = async ({ http, fixture, el }: Awaited<ReturnType<typeof mount>>) => {
  byTestId(el, 'request-change')!.click();
  await settle(fixture);
  http
    .expectOne('/api/agreements/a1/amendments/options')
    .flush({ options: HOUSE_DETAIL, selections: { kitchen: { packageId: 'chef' } } });
  await settle(fixture);
  await fixture.whenStable();
  await settle(fixture);
  return byTestId(document, 'change-request')!;
};

describe('AgreementRoomPage (change orders)', () => {
  it('the buyer picks options from the catalog, sees a taxed estimate and sends the request', async () => {
    const m = await mount();
    const sheet = await openRequest(m);
    expect(byTestId<HTMLButtonElement>(sheet, 'request-submit')!.disabled).toBe(true);

    byTestId(sheet, 'item-stone')!.click();
    await settle(m.fixture);
    await pause();
    const preview = m.http.expectOne('/api/agreements/a1/amendments/preview');
    expect(preview.request.body).toEqual({
      changes: [{ type: 'add_item', areaSlug: 'exterior', itemId: 'stone' }],
    });
    preview.flush({
      quote: taxedQuote({ totalCents: 63_892_500 }),
      changes: [{ label: 'Add Stone (Exterior)', deltaCents: 900_000 }],
    });
    await settle(m.fixture);
    const estimate = byTestId(sheet, 'request-estimate')!;
    expect(estimate.textContent).toContain('Add Stone (Exterior)');
    expect(estimate.textContent).toContain('+$9,000');
    expect(estimate.textContent).toContain('$638,925');
    expect(estimate.textContent).toContain('sales tax included');

    type(byTestId<HTMLTextAreaElement>(sheet, 'request-note')!, ' Same stone as the show home ');
    await settle(m.fixture);
    byTestId(sheet, 'request-submit')!.click();
    await settle(m.fixture);
    const sent = m.http.expectOne('/api/agreements/a1/amendments');
    expect(sent.request.method).toBe('POST');
    expect(sent.request.body).toEqual({
      changes: [{ type: 'add_item', areaSlug: 'exterior', itemId: 'stone' }],
      note: 'Same stone as the show home',
    });
    sent.flush(amendment(), { status: 201, statusText: 'Created' });
    await settle(m.fixture);
    m.http.expectOne('/api/agreements/a1/amendments').flush([amendment()]);
    m.http
      .expectOne('/api/agreements/a1/amendments/current')
      .flush(current({ openAmendmentId: 'amd-1' }));
    await settle(m.fixture);
    expect(byTestId(document, 'change-request')).toBeNull();
    expect(byTestId(m.el, 'change-order-amd-1')?.textContent).toContain('CO-AAAA-0001');
    expect(byTestId(m.el, 'request-change')).toBeNull();
  });

  it('the buyer can describe the change in their own words only', async () => {
    const m = await mount();
    const sheet = await openRequest(m);
    type(byTestId<HTMLTextAreaElement>(sheet, 'request-note')!, 'A wider patio door');
    await settle(m.fixture);
    expect(byTestId(sheet, 'request-estimate')).toBeNull();
    byTestId(sheet, 'request-submit')!.click();
    await settle(m.fixture);
    const sent = m.http.expectOne('/api/agreements/a1/amendments');
    expect(sent.request.body).toEqual({ changes: [], note: 'A wider patio door' });
  });

  it('one change order at a time, and none on a home offered as-is', async () => {
    const open = await mount([amendment()], current({ openAmendmentId: 'amd-1' }));
    expect(byTestId(open.el, 'request-change')).toBeNull();
    expect(byTestId(open.el, 'one-at-a-time')?.textContent).toContain('one change order at a time');
    TestBed.resetTestingModule();

    const asIs = await mount([], current({ offeredAsIs: true }));
    expect(byTestId(asIs.el, 'request-change')).toBeNull();
    expect(byTestId(asIs.el, 'offered-as-is')?.textContent).toContain('offered as-is');
  });

  it('the buyer follows their change orders and withdraws one not yet signed', async () => {
    const m = await mount([pricedAmendment()], current({ openAmendmentId: 'amd-1' }));
    const card = byTestId(m.el, 'change-order-amd-1')!;
    expect(card.textContent).toContain('Change order 1');
    expect(card.textContent).toContain('Being prepared');
    expect(card.textContent).toContain('$629,475');
    expect(card.textContent).toContain('$638,925');

    byTestId(card, 'withdraw-amd-1')!.click();
    await settle(m.fixture);
    TestBed.inject(ConfirmService).answer(true);
    await settle(m.fixture);
    const withdraw = m.http.expectOne('/api/agreements/a1/amendments/amd-1/withdraw');
    expect(withdraw.request.body).toEqual({});
    withdraw.flush(pricedAmendment({ status: AmendmentStatus.Withdrawn }));
    await settle(m.fixture);
    m.http
      .expectOne('/api/agreements/a1/amendments')
      .flush([pricedAmendment({ status: AmendmentStatus.Withdrawn })]);
    m.http.expectOne('/api/agreements/a1/amendments/current').flush(current());
    await settle(m.fixture);
    expect(byTestId(m.el, 'change-order-amd-1')?.textContent).toContain('Withdrawn');
    expect(byTestId(m.el, 'withdraw-amd-1')).toBeNull();
    expect(byTestId(m.el, 'request-change')).not.toBeNull();
  });

  it('an executed change order shows in the price, and its PDF is kept', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:co'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const done = pricedAmendment({
      status: AmendmentStatus.Executed,
      executedAt: '2026-11-12T10:00:00.000Z',
    });
    const m = await mount(
      [done],
      current({
        state: agreementState(AGREEMENT, [
          {
            number: 1,
            reference: done.reference,
            contentHash: done.contentHash!,
            executedAt: done.executedAt!,
            quote: done.after!.quote,
            terms: done.after!.terms,
          },
        ]),
      }),
    );
    expect(m.el.querySelector('header')?.textContent).toContain('$638,925');
    expect(byTestId(m.el, 'change-order-amd-1')?.textContent).toContain('Executed');

    byTestId(m.el, 'download-amd-1')!.click();
    await settle(m.fixture);
    const req = m.http.expectOne('/api/agreements/a1/amendments/amd-1/pdf');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['%PDF-1.3'], { type: 'application/pdf' }));
    await settle(m.fixture);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'CO-AAAA-0001-executed.pdf',
    );
    click.mockRestore();
  });

  it('the buyer’s payments follow the amended price and say how it changed', async () => {
    const ledger = (totalCents: number, paidCents: number): BuyerLedger => ({
      agreementId: 'a1',
      agreementReference: 'A-2001',
      currency: 'CAD',
      schedule: paymentSchedule(
        { deposits: AGREEMENT.terms.deposits, closingDate: '2027-06-30', totalCents },
        [{ kind: PaymentKind.Payment, status: PaymentStatus.Posted, amountCents: paidCents }],
        '2026-11-15',
      ),
      payments: [],
      priceChanges: [
        {
          number: 1,
          reference: 'CO-AAAA-0001',
          executedAt: '2026-11-12T10:00:00.000Z',
          fromCents: AGREEMENT.quote.totalCents,
          toCents: totalCents,
        },
      ],
    });
    const more = await mount([], current(), ledger(63_892_500, 3_000_000));
    const card = byTestId(more.el, 'buyer-payments')!;
    expect(card.textContent).toContain('$608,925 left to pay');
    expect(byTestId(card, 'price-changes')?.textContent).toContain('Signed at $629,475');
    expect(byTestId(card, 'price-changes')?.textContent).toContain('$638,925');
    expect(byTestId(card, 'buyer-credit')).toBeNull();
    TestBed.resetTestingModule();

    const less = await mount([], current(), ledger(60_000_000, 62_947_500));
    expect(byTestId(less.el, 'buyer-credit')?.textContent).toContain(
      'You paid $29,475 more than the new price; Example Homes owes it back to you.',
    );
  });
});
