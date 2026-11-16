import { AmendmentStatus, ApprovalReason, Role } from '@homepact/shared/enums';
import type { Amendment, AmendmentDraftPreview } from '@homepact/shared';
import { TestBed } from '@angular/core/testing';
import { settle, setup, signInAs } from '../../testing';
import {
  amendment,
  executedAgreement,
  HOUSE_DETAIL,
  pause,
  pricedAmendment,
  signedPurchaser,
} from '../../testing-fixtures';
import { AgreementAmendments } from './agreement-amendments';

const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input'));
};
const BASE = '/api/agreements/a1/amendments';
const STONE = { type: 'add_item', areaSlug: 'exterior', itemId: 'stone' };

const mount = async (
  orders: Amendment[],
  role = Role.CompanyStaff,
  name = 'Jordan Blake',
  id = 'me',
) => {
  const http = setup();
  await signInAs(http, role, name, id);
  const fixture = TestBed.createComponent(AgreementAmendments);
  fixture.componentRef.setInput('agreement', executedAgreement());
  await settle(fixture);
  http.expectOne(BASE).flush(orders);
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};

/** Opens the draft sheet of `amd-1` and answers the catalog it loads. */
const openDraft = async ({ http, fixture, el }: Awaited<ReturnType<typeof mount>>) => {
  byTestId(el, 'draft-amd-1')!.click();
  await settle(fixture);
  http
    .expectOne(`${BASE}/options`)
    .flush({ options: HOUSE_DETAIL, selections: { kitchen: { packageId: 'chef' } } });
  await settle(fixture);
  await fixture.whenStable();
  await settle(fixture);
  return byTestId(document, 'amendment-draft')!;
};

const previewOf = (over: Partial<AmendmentDraftPreview> = {}): AmendmentDraftPreview => ({
  changes: pricedAmendment().changes,
  after: pricedAmendment().after!,
  approval: { required: false, reasons: [] },
  ...over,
});

describe('AgreementAmendments (the company’s side of change orders)', () => {
  it('sales turns a request in the buyer’s words into catalog changes, priced with tax', async () => {
    const inWords = amendment({ changes: [], note: 'Stone on the front, like the show home' });
    const m = await mount([inWords]);
    expect(byTestId(m.el, 'change-order-amd-1')?.textContent).toContain('Stone on the front');
    const sheet = await openDraft(m);
    expect(sheet.textContent).toContain('Stone on the front, like the show home');

    byTestId(sheet, 'item-stone')!.click();
    await settle(m.fixture);
    await pause();
    const preview = m.http.expectOne(`${BASE}/amd-1/price-preview`);
    expect(preview.request.body).toEqual({
      decisions: [],
      added: [STONE],
      adjustments: [],
      deposits: [],
    });
    preview.flush(
      previewOf({ changes: [{ ...pricedAmendment().changes[0]!, addedBySeller: true }] }),
    );
    await settle(m.fixture);
    const priced = byTestId(sheet, 'draft-preview')!;
    for (const text of [
      'Add Stone (Exterior)',
      '+$9,000',
      '$608,500',
      'GST',
      '$30,425',
      '$638,925',
    ]) {
      expect(priced.textContent, text).toContain(text);
    }
    expect(byTestId(sheet, 'draft-approval')).toBeNull();

    byTestId(sheet, 'draft-save')!.click();
    await settle(m.fixture);
    const save = m.http.expectOne(`${BASE}/amd-1`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({
      decisions: [],
      added: [STONE],
      adjustments: [],
      deposits: [],
    });
    save.flush(pricedAmendment());
    await settle(m.fixture);
    m.http.expectOne(BASE).flush([pricedAmendment()]);
    await settle(m.fixture);
    expect(byTestId(document, 'amendment-draft')).toBeNull();
    expect(byTestId(m.el, 'send-amd-1')).not.toBeNull();
  });

  it('sales decides each requested change, adds a fee and sees it will need approval', async () => {
    const m = await mount([amendment()]);
    const sheet = await openDraft(m);
    expect(byTestId<HTMLInputElement>(sheet, 'decide-chg-1')!.checked).toBe(true);
    byTestId(sheet, 'adjustments')!.querySelector<HTMLButtonElement>('button.add')!.click();
    await settle(m.fixture);
    const [label, amount] = Array.from(
      byTestId(sheet, 'adjustments')!.querySelectorAll<HTMLInputElement>('input'),
    );
    type(label!, 'Change order fee');
    type(amount!, '250');
    await settle(m.fixture);
    await pause();
    const preview = m.http.expectOne(`${BASE}/amd-1/price-preview`);
    expect(preview.request.body).toEqual({
      decisions: [{ changeId: 'chg-1', approved: true }],
      added: [],
      adjustments: [{ label: 'Change order fee', amountCents: 25_000 }],
      deposits: [],
    });
    preview.flush(
      previewOf({ approval: { required: true, reasons: [ApprovalReason.Adjustment] } }),
    );
    await settle(m.fixture);
    expect(byTestId(sheet, 'draft-approval')?.textContent).toContain('A fee or credit set by hand');
  });

  it('sales moves the closing date in the draft', async () => {
    const m = await mount([amendment()]);
    const sheet = await openDraft(m);
    const closing = byTestId<HTMLInputElement>(sheet, 'draft-closing')!;
    expect(closing.value).toBe('');
    type(closing, '2027-06-30');
    await settle(m.fixture);
    await pause();
    expect(m.http.expectOne(`${BASE}/amd-1/price-preview`).request.body).toEqual({
      decisions: [{ changeId: 'chg-1', approved: true }],
      added: [],
      adjustments: [],
      deposits: [],
      closingDate: '2027-06-30',
    });
  });

  it('sales signs for the company and hands out each purchaser’s link and code', async () => {
    const m = await mount([pricedAmendment()]);
    byTestId(m.el, 'send-amd-1')!.click();
    await settle(m.fixture);
    expect(byTestId<HTMLInputElement>(document, 'send-name')!.value).toBe('Jordan Blake');
    byTestId<HTMLInputElement>(document, 'send-agree')!.click();
    await settle(m.fixture);
    byTestId(document, 'send-submit')!.click();
    await settle(m.fixture);
    const issue = m.http.expectOne(`${BASE}/amd-1/issue`);
    expect(issue.request.body).toEqual({
      contentHash: 'c'.repeat(64),
      fullName: 'Jordan Blake',
      agree: true,
    });
    issue.flush({
      amendment: pricedAmendment({ status: AmendmentStatus.UnderReview }),
      invitations: [
        { purchaserId: 'pur-1', name: 'Robin Buyer', key: 'key 1', code: 'AAAA-BBBB' },
        { purchaserId: 'pur-2', name: 'Sam Buyer', key: 'key-2', code: 'CCCC-DDDD' },
      ],
    });
    await settle(m.fixture);
    m.http.expectOne(BASE).flush([pricedAmendment({ status: AmendmentStatus.UnderReview })]);
    await settle(m.fixture);
    expect(byTestId(document, 'link-pur-1')?.textContent).toContain('/k?key=key%201');
    expect(byTestId(document, 'code-pur-2')?.textContent).toContain('CCCC-DDDD');
  });

  const awaiting = pricedAmendment({
    status: AmendmentStatus.AwaitingApproval,
    approval: { required: true, reasons: [ApprovalReason.Adjustment] },
    adjustments: [{ label: 'Change order fee', amountCents: 25_000 }],
    purchasers: [signedPurchaser(), signedPurchaser({ id: 'pur-2', name: 'Sam Buyer' })],
    issuedBy: { id: 'me', name: 'Jordan Blake', role: Role.CompanyStaff },
    signedAt: '2026-11-12T10:00:00.000Z',
  });

  it('an administrator approves a change order someone else priced and sent', async () => {
    const m = await mount([awaiting], Role.CompanyAdmin, 'Alex Admin', 'admin-1');
    const executed = vi.fn();
    m.fixture.componentInstance.executed.subscribe(executed);
    expect(byTestId(m.el, 'change-order-amd-1')?.textContent).toContain(
      'A fee or credit set by hand',
    );
    byTestId(m.el, 'approve-amd-1')!.click();
    await settle(m.fixture);
    expect(byTestId<HTMLInputElement>(document, 'approve-name')!.value).toBe('Alex Admin');
    byTestId<HTMLInputElement>(document, 'approve-agree')!.click();
    await settle(m.fixture);
    byTestId(document, 'approve-submit')!.click();
    await settle(m.fixture);
    const approve = m.http.expectOne(`${BASE}/amd-1/approve`);
    expect(approve.request.body).toEqual({
      contentHash: 'c'.repeat(64),
      fullName: 'Alex Admin',
      agree: true,
    });
    approve.flush({ ...awaiting, status: AmendmentStatus.Executed });
    await settle(m.fixture);
    m.http.expectOne(BASE).flush([{ ...awaiting, status: AmendmentStatus.Executed }]);
    await settle(m.fixture);
    expect(byTestId(m.el, 'change-order-amd-1')?.textContent).toContain('Executed');
    expect(executed).toHaveBeenCalledTimes(1);
  });

  it('an administrator can refuse it, with a reason', async () => {
    const m = await mount([awaiting], Role.CompanyAdmin, 'Alex Admin', 'admin-1');
    byTestId(m.el, 'reject-amd-1')!.click();
    await settle(m.fixture);
    type(byTestId<HTMLInputElement>(document, 'reason')!, 'Fee should be waived');
    await settle(m.fixture);
    byTestId(document, 'reason-submit')!.click();
    await settle(m.fixture);
    const reject = m.http.expectOne(`${BASE}/amd-1/reject`);
    expect(reject.request.body).toEqual({ reason: 'Fee should be waived' });
  });

  it('whoever priced or sent it cannot approve it, and finance only reads', async () => {
    const own = await mount([awaiting], Role.CompanyAdmin, 'Jordan Blake', 'me');
    expect(byTestId(own.el, 'approve-amd-1')).toBeNull();
    expect(byTestId(own.el, 'approve-someone-else')?.textContent).toContain(
      'Another administrator must approve it',
    );
    TestBed.resetTestingModule();

    const finance = await mount(
      [amendment(), pricedAmendment({ id: 'amd-2' })],
      Role.CompanyFinance,
    );
    expect(byTestId(finance.el, 'draft-amd-1')).toBeNull();
    expect(byTestId(finance.el, 'send-amd-2')).toBeNull();
    expect(byTestId(finance.el, 'decline-amd-1')).toBeNull();
    expect(byTestId(finance.el, 'new-change-order')).toBeNull();
  });

  it('sales declines a request, saying why', async () => {
    const m = await mount([amendment()]);
    byTestId(m.el, 'decline-amd-1')!.click();
    await settle(m.fixture);
    type(byTestId<HTMLInputElement>(document, 'reason')!, 'Foundation already poured');
    await settle(m.fixture);
    byTestId(document, 'reason-submit')!.click();
    await settle(m.fixture);
    expect(m.http.expectOne(`${BASE}/amd-1/decline`).request.body).toEqual({
      reason: 'Foundation already poured',
    });
  });

  it('sales opens a change order for the buyer, in their words', async () => {
    const m = await mount([]);
    byTestId(m.el, 'new-change-order')!.click();
    await settle(m.fixture);
    type(byTestId<HTMLTextAreaElement>(document, 'new-note')!, 'Asked by phone: stone front');
    await settle(m.fixture);
    byTestId(document, 'new-submit')!.click();
    await settle(m.fixture);
    const req = m.http.expectOne(BASE);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ changes: [], note: 'Asked by phone: stone front' });
  });
});
