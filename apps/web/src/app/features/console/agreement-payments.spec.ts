import {
  AgreementStatus,
  isRefundableAgreement,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
} from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import type { Agreement, AgreementPayment, PaymentActor } from '@homepact/shared';
import { ConfirmService } from '../../core/confirm.service';
import { settle, setup, signInAs } from '../../testing';
import {
  agreement,
  FINANCE,
  ledgerOf,
  payment,
  SALES,
  signedPurchaser,
} from '../../testing-fixtures';
import { AgreementPage } from './agreement.page';

const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);
const type = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input'));
};
const signed = (overrides: Partial<Agreement> = {}) =>
  agreement({
    status: AgreementStatus.Signed,
    issuedAt: '2026-11-02T10:00:00.000Z',
    signedAt: '2026-11-02T10:00:00.000Z',
    purchasers: [signedPurchaser()],
    ...overrides,
  });
const pending = (overrides: Partial<AgreementPayment> = {}) =>
  payment({
    id: 'pay-2',
    reference: 'PAY-BBBB-0002',
    status: PaymentStatus.Pending,
    recordedBy: SALES,
    ...overrides,
  });

const mount = async (
  who: PaymentActor,
  body: Agreement = signed(),
  entries: AgreementPayment[] = [],
) => {
  const http = setup();
  await signInAs(http, who.role, who.name, who.id);
  const fixture = TestBed.createComponent(AgreementPage);
  fixture.componentRef.setInput('id', 'a1');
  await settle(fixture);
  http.expectOne('/api/agreements/a1').flush(body);
  await settle(fixture);
  if (isRefundableAgreement(body.status)) {
    http.expectOne('/api/agreements/a1/payments').flush(ledgerOf(body, entries));
    await settle(fixture);
  }
  const el = fixture.nativeElement as HTMLElement;
  const reloadWith = async (next: AgreementPayment[]) => {
    await settle(fixture);
    http.expectOne('/api/agreements/a1/payments').flush(ledgerOf(body, next));
    await settle(fixture);
  };
  return { http, fixture, el, reloadWith };
};

const fillPayment = async (
  fixture: { detectChanges(): void },
  values: { amount?: string; date?: string; method?: PaymentMethod; ref?: string },
) => {
  if (values.amount) type(byTestId<HTMLInputElement>(document, 'payment-amount')!, values.amount);
  if (values.date) type(byTestId<HTMLInputElement>(document, 'payment-date')!, values.date);
  if (values.method) type(byTestId<HTMLSelectElement>(document, 'payment-method')!, values.method);
  if (values.ref) type(byTestId<HTMLInputElement>(document, 'payment-ref')!, values.ref);
  await settle(fixture);
};

describe('AgreementPage (payments)', () => {
  it('sales record the deposit cheque, and it waits for finance before it counts', async () => {
    const { http, fixture, el, reloadWith } = await mount(SALES);
    expect(byTestId(el, 'schedule-line-0')?.textContent).toContain('on signing');
    expect(byTestId(el, 'schedule-line-0')?.textContent).toContain('Due');
    expect(byTestId(el, 'schedule-line-1')?.textContent).toContain('Balance due on closing');

    byTestId(el, 'record-payment')!.click();
    await settle(fixture);
    expect(byTestId(document, 'payment-approval-hint')?.textContent).toContain(
      'Finance approves it before it counts',
    );
    expect(byTestId(document, 'payment-kind')).toBeNull();
    await fillPayment(fixture, {
      amount: '30000',
      date: '2026-11-03',
      method: PaymentMethod.Cheque,
      ref: '#1042',
    });
    byTestId(document, 'payment-submit')!.click();
    await settle(fixture);
    const req = http.expectOne('/api/agreements/a1/payments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      kind: PaymentKind.Payment,
      amountCents: 3_000_000,
      receivedOn: '2026-11-03',
      method: PaymentMethod.Cheque,
      externalRef: '#1042',
    });
    const recorded = pending({ amountCents: 3_000_000 });
    req.flush(recorded);
    await reloadWith([recorded]);

    expect(byTestId(el, 'payment-pay-2')?.textContent).toContain('Waiting for approval');
    expect(byTestId(el, 'payments-pending')?.textContent).toContain('$30,000');
    expect(byTestId(el, 'schedule-line-0')?.textContent).toContain('Due');
    expect(byTestId(el, 'approve-pay-2')).toBeNull();
  });

  it('finance approves what sales recorded, and the instalment shows as paid', async () => {
    const entry = pending({ amountCents: 3_000_000 });
    const { http, fixture, el, reloadWith } = await mount(FINANCE, signed(), [entry]);
    expect(byTestId(el, 'payment-pay-2')?.textContent).toContain('Jordan Blake');
    expect(byTestId(el, 'edit-pay-2')).toBeNull();
    expect(byTestId(el, 'withdraw-pay-2')).toBeNull();
    byTestId(el, 'approve-pay-2')!.click();
    await settle(fixture);
    http.expectOne('/api/agreements/a1/payments/pay-2/approve').flush({});
    await reloadWith([{ ...entry, status: PaymentStatus.Posted, reviewedBy: FINANCE }]);

    expect(byTestId(el, 'schedule-line-0')?.textContent).toContain('Paid');
    expect(byTestId(el, 'payments-received')?.textContent).toContain('$30,000');
    expect(byTestId(el, 'payments-pending')).toBeNull();
  });

  it('an entry needs someone else to approve it, even once its author works in finance', async () => {
    const { el } = await mount(FINANCE, signed(), [pending({ recordedBy: FINANCE })]);
    expect(byTestId(el, 'payment-pay-2')?.textContent).toContain('Waiting for approval');
    expect(byTestId(el, 'approve-pay-2')).toBeNull();
  });

  it('a bounced cheque is voided with a reason, and the right payment recorded in its place', async () => {
    const bounced = payment();
    const { http, fixture, el, reloadWith } = await mount(FINANCE, signed(), [bounced]);
    byTestId(el, 'void-pay-1')!.click();
    await settle(fixture);
    type(byTestId<HTMLInputElement>(document, 'reason')!, 'NSF cheque');
    await settle(fixture);
    byTestId(document, 'reason-submit')!.click();
    await settle(fixture);
    const voiding = http.expectOne('/api/agreements/a1/payments/pay-1/void');
    expect(voiding.request.body).toEqual({ reason: 'NSF cheque' });
    voiding.flush({});
    await reloadWith([{ ...bounced, status: PaymentStatus.Voided, voidReason: 'NSF cheque' }]);
    expect(byTestId(el, 'payment-pay-1')?.textContent).toContain('Voided');
    expect(byTestId(el, 'payment-pay-1')?.textContent).toContain('NSF cheque');

    byTestId(el, 'reenter-pay-1')!.click();
    await settle(fixture);
    expect(Number(byTestId<HTMLInputElement>(document, 'payment-amount')!.value)).toBe(10_000);
    await fillPayment(fixture, { method: PaymentMethod.BankDraft, ref: 'BD-77' });
    byTestId(document, 'payment-submit')!.click();
    await settle(fixture);
    const reentered = http.expectOne('/api/agreements/a1/payments');
    expect(reentered.request.body).toMatchObject({
      amountCents: 1_000_000,
      method: PaymentMethod.BankDraft,
      externalRef: 'BD-77',
      replacesId: 'pay-1',
    });
  });

  it('recording the same cheque twice asks before recording it again', async () => {
    const { http, fixture, el } = await mount(FINANCE, signed(), [payment()]);
    byTestId(el, 'record-payment')!.click();
    await settle(fixture);
    await fillPayment(fixture, { amount: '10000', date: '2026-11-03', ref: '#1042' });
    byTestId(document, 'payment-submit')!.click();
    await settle(fixture);
    http.expectOne('/api/agreements/a1/payments').flush(
      {
        error: 'A payment with the same amount, date and reference is already recorded',
        details: { duplicateOf: ['PAY-AAAA-0001'] },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle(fixture);
    const confirm = TestBed.inject(ConfirmService);
    expect(confirm.pending()?.message).toContain('PAY-AAAA-0001');
    confirm.answer(true);
    await settle(fixture);
    const again = http.expectOne('/api/agreements/a1/payments');
    expect(again.request.body).toMatchObject({ amountCents: 1_000_000, allowDuplicate: true });
  });

  it('sales fix their own entry while it waits, or take it back', async () => {
    const entry = pending();
    const { http, fixture, el, reloadWith } = await mount(SALES, signed(), [entry]);
    byTestId(el, 'edit-pay-2')!.click();
    await settle(fixture);
    expect(byTestId<HTMLInputElement>(document, 'payment-ref')!.value).toBe('#1042');
    await fillPayment(fixture, { amount: '12500' });
    byTestId(document, 'payment-submit')!.click();
    await settle(fixture);
    const edit = http.expectOne('/api/agreements/a1/payments/pay-2');
    expect(edit.request.method).toBe('PUT');
    expect(edit.request.body).toMatchObject({ amountCents: 1_250_000, externalRef: '#1042' });
    edit.flush({});
    await reloadWith([{ ...entry, amountCents: 1_250_000 }]);

    byTestId(el, 'withdraw-pay-2')!.click();
    await settle(fixture);
    TestBed.inject(ConfirmService).answer(true);
    await settle(fixture);
    http.expectOne('/api/agreements/a1/payments/pay-2/withdraw').flush({});
    await reloadWith([{ ...entry, status: PaymentStatus.Withdrawn }]);
    expect(byTestId(el, 'payment-pay-2')?.textContent).toContain('Withdrawn');
    expect(byTestId(el, 'edit-pay-2')).toBeNull();
  });

  it('after a cancellation, finance refunds the deposit the company still holds', async () => {
    const cancelled = signed({
      status: AgreementStatus.Cancelled,
      cancelledAt: '2026-11-04T10:00:00.000Z',
    });
    const { http, fixture, el } = await mount(FINANCE, cancelled, [payment()]);
    expect(byTestId(el, 'payments-held')?.textContent).toContain('$10,000');
    byTestId(el, 'record-refund')!.click();
    await settle(fixture);
    await fillPayment(fixture, {
      amount: '10000',
      date: '2026-11-05',
      method: PaymentMethod.Wire,
    });
    byTestId(document, 'payment-submit')!.click();
    await settle(fixture);
    expect(http.expectOne('/api/agreements/a1/payments').request.body).toEqual({
      kind: PaymentKind.Refund,
      amountCents: 1_000_000,
      receivedOn: '2026-11-05',
      method: PaymentMethod.Wire,
    });
  });

  it('sales cannot take payments on a cancelled agreement or give money back', async () => {
    const cancelled = signed({ status: AgreementStatus.Cancelled });
    const { el } = await mount(SALES, cancelled, [payment()]);
    expect(byTestId(el, 'record-payment')).toBeNull();
    expect(byTestId(el, 'record-refund')).toBeNull();
  });

  it('finance reads the agreement to follow its payments, without changing it', async () => {
    const { el } = await mount(FINANCE);
    for (const action of ['edit-terms', 'cancel', 'countersign', 'reinvite-pur-1']) {
      expect(byTestId(el, action), action).toBeNull();
    }
    expect(el.querySelector('a[href^="/console/proposals"]')).toBeNull();
    expect(byTestId(el, 'record-payment')).not.toBeNull();
  });

  it('a draft takes no payments', async () => {
    const { http, el } = await mount(SALES, agreement());
    expect(byTestId(el, 'payments')).toBeNull();
    http.expectNone('/api/agreements/a1/payments');
  });
});
