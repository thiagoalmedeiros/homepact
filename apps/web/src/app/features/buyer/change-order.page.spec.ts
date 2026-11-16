import { AmendmentStatus, ApprovalReason, Role, SignerStatus } from '@homepact/shared/enums';
import type { Amendment } from '@homepact/shared';
import { TestBed } from '@angular/core/testing';
import { settle, setup } from '../../testing';
import { pricedAmendment, purchaser, signedPurchaser } from '../../testing-fixtures';
import { ChangeOrderPage } from './change-order.page';

const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);

/** Sent for signature; this session is Robin's signing link. */
const sent = (over: Partial<Amendment> = {}) =>
  pricedAmendment({
    status: AmendmentStatus.UnderReview,
    issuedAt: '2026-11-11T12:00:00.000Z',
    issuedBy: { id: 'me', name: 'Jordan Blake', role: Role.CompanyStaff },
    viewerPurchaserId: 'pur-1',
    ...over,
  });

const mount = async (body: object = sent(), status = 200) => {
  const http = setup();
  const fixture = TestBed.createComponent(ChangeOrderPage);
  fixture.componentRef.setInput('id', 'amd-1');
  await settle(fixture);
  http
    .expectOne('/api/amendments/amd-1')
    .flush(body, status === 200 ? {} : { status, statusText: 'Not Found' });
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};

describe('ChangeOrderPage (a purchaser’s signing link)', () => {
  it('the purchaser reads what changes and at what price, then signs exactly that', async () => {
    const { http, fixture, el } = await mount(sent({ closingDate: '2027-06-30' }));
    expect(byTestId(el, 'amendment-closing')?.textContent).toContain(
      'Closing and possession moves from March 15, 2027 to June 30, 2027',
    );
    expect(byTestId(el, 'to-sign')?.textContent).toContain('Example Homes sent you this change');
    const view = byTestId(el, 'amendment-view')!;
    for (const text of [
      'Change order 1',
      'A-2001',
      'Add Stone (Exterior)',
      '+$9,000',
      '$638,925',
    ]) {
      expect(view.textContent, text).toContain(text);
    }

    byTestId(el, 'open-sign')!.click();
    await settle(fixture);
    expect(byTestId<HTMLInputElement>(document, 'sign-name')!.value).toBe('Robin Buyer');
    const submit = byTestId<HTMLButtonElement>(document, 'sign-submit')!;
    expect(submit.disabled).toBe(true);
    byTestId<HTMLInputElement>(document, 'sign-agree')!.click();
    await settle(fixture);
    submit.click();
    await settle(fixture);
    const req = http.expectOne('/api/agreements/a1/amendments/amd-1/sign');
    expect(req.request.body).toEqual({
      contentHash: 'c'.repeat(64),
      fullName: 'Robin Buyer',
      agree: true,
    });
    req.flush(
      sent({ purchasers: [signedPurchaser(), purchaser({ id: 'pur-2', name: 'Sam Buyer' })] }),
    );
    await settle(fixture);
    expect(byTestId(el, 'you-signed')?.textContent).toContain('You signed this change order');
    expect(byTestId(el, 'open-sign')).toBeNull();
  });

  it('after the signatures it says what it waits for, and once executed it keeps the PDF', async () => {
    const waiting = await mount(
      sent({
        status: AmendmentStatus.AwaitingApproval,
        purchasers: [signedPurchaser()],
        approval: { required: true, reasons: [ApprovalReason.Adjustment] },
      }),
    );
    expect(byTestId(waiting.el, 'awaiting-approval')?.textContent).toContain(
      'waiting for Example Homes to approve it',
    );
    TestBed.resetTestingModule();

    const done = await mount(
      sent({
        status: AmendmentStatus.Executed,
        executedAt: '2026-11-12T10:00:00.000Z',
        purchasers: [signedPurchaser({ status: SignerStatus.Signed })],
        approval: { required: true, reasons: [ApprovalReason.Adjustment] },
        approvedAt: '2026-11-12T10:00:00.000Z',
        approvedBy: { id: 'admin-1', name: 'Alex Admin', role: Role.CompanyAdmin },
      }),
    );
    expect(byTestId(done.el, 'executed')?.textContent).toContain('This change order is executed');
    expect(byTestId(done.el, 'approved-by')?.textContent).toContain('Approved by Alex Admin');
    expect(byTestId(done.el, 'approval-reasons')).toBeNull();
    expect(byTestId(done.el, 'download-pdf')).not.toBeNull();
    expect(byTestId(done.el, 'open-sign')).toBeNull();
  });

  it('a link that no longer opens anything says so', async () => {
    const { el } = await mount({ error: 'Not found' }, 404);
    expect(el.textContent).toContain("This change order isn't available");
  });
});
