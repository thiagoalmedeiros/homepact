import { AgreementStatus, Role, SignerStatus } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { ConfirmService } from '../../core/confirm.service';
import { settle, setup, signInAs } from '../../testing';
import { agreement, purchaser, signedPurchaser, TEMPLATES } from '../../testing-fixtures';
import { AgreementPage } from './agreement.page';

const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input'));
};

/** Opens the terms sheet and waits until its form is wired to the component. */
const openTerms = async (
  http: ReturnType<typeof setup>,
  fixture: { detectChanges(): void; whenStable(): Promise<unknown> },
  el: HTMLElement,
) => {
  byTestId(el, 'edit-terms')!.click();
  await settle(fixture);
  http.expectOne('/api/agreement-templates').flush(TEMPLATES);
  await settle(fixture);
  await fixture.whenStable();
  await settle(fixture);
};

const mount = async (body = agreement(), role = Role.CompanyStaff, name = 'Jordan Blake') => {
  const http = setup();
  await signInAs(http, role, name);
  const fixture = TestBed.createComponent(AgreementPage);
  fixture.componentRef.setInput('id', 'a1');
  await settle(fixture);
  http.expectOne('/api/agreements/a1').flush(body);
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};

const sent = (overrides = {}) =>
  agreement({
    status: AgreementStatus.UnderReview,
    issuedAt: '2026-11-02T10:00:00.000Z',
    issuedByName: 'Jordan Blake',
    purchasers: [purchaser({ invitedAt: '2026-11-02T10:00:00.000Z' })],
    ...overrides,
  });

describe('AgreementPage (seller)', () => {
  it('the seller edits the draft terms', async () => {
    const { http, fixture, el } = await mount();
    expect(byTestId(el, 'draft-banner')?.textContent).toContain('Only your team can see it');
    expect(byTestId(el, 'agreement-status')?.textContent).toContain('Draft');
    expect(byTestId(el, 'signer-pur-1')?.textContent).toContain('Not sent yet');

    await openTerms(http, fixture, el);
    expect(byTestId<HTMLSelectElement>(document, 'terms-template')!.value).toBe('t1');
    expect(byTestId<HTMLInputElement>(document, 'purchaser-name-0')!.value).toBe('Robin Buyer');
    const amount = byTestId<HTMLInputElement>(document, 'deposit-amount-0')!;
    expect(Number(amount.value)).toBe(30_000);
    type(amount, '45000');
    type(byTestId<HTMLTextAreaElement>(document, 'terms-special')!, ' Deck before possession. ');
    await settle(fixture);
    byTestId(document, 'terms-submit')!.click();
    await settle(fixture);
    const put = http.expectOne('/api/agreements/a1');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toMatchObject({
      templateId: 't1',
      purchasers: [{ name: 'Robin Buyer', email: 'robin@example.com' }],
      deposits: [{ label: 'on signing', amountCents: 4_500_000 }],
      closingDate: '2027-03-15',
      specialTerms: 'Deck before possession.',
    });
    put.flush(agreement({ contentHash: 'b'.repeat(64) }));
    await settle(fixture);
    expect(byTestId(el, 'draft-banner')).not.toBeNull();
  });

  it('sending is bound to the content on screen, and hands out the links and codes', async () => {
    const updatedHash = 'b'.repeat(64);
    const { http, fixture, el } = await mount(agreement({ contentHash: updatedHash }));
    byTestId(el, 'issue')!.click();
    await settle(fixture);
    const confirm = TestBed.inject(ConfirmService);
    expect(confirm.pending()?.message).toContain('their own link and code');
    confirm.answer(true);
    await settle(fixture);
    const issue = http.expectOne('/api/agreements/a1/issue');
    expect(issue.request.body).toEqual({ contentHash: updatedHash });
    issue.flush({
      agreement: sent(),
      invitations: [
        {
          purchaserId: 'pur-1',
          name: 'Robin Buyer',
          email: 'robin@example.com',
          key: 'plain-key',
          code: 'ABCD-EFGH',
        },
      ],
    });
    await settle(fixture);
    expect(byTestId(el, 'agreement-status')?.textContent).toContain('Out for signature');
    expect(byTestId(el, 'issue')).toBeNull();
    expect(byTestId(document, 'code-pur-1')?.textContent).toContain('ABCD-EFGH');
    expect(byTestId(document, 'handout-pur-1')?.textContent).toContain('/k?key=plain-key');
  });

  it('a deposit above the price cannot be submitted', async () => {
    const { http, fixture, el } = await mount();
    await openTerms(http, fixture, el);
    type(byTestId<HTMLInputElement>(document, 'deposit-amount-0')!, '700000');
    await settle(fixture);
    expect(document.body.textContent).toContain('cannot be more than the purchase price');
    expect(byTestId<HTMLButtonElement>(document, 'terms-submit')!.disabled).toBe(true);
  });

  it('changing a clause after a signature is confirmed first', async () => {
    const { http, fixture, el } = await mount(sent({ purchasers: [signedPurchaser()] }));
    expect(byTestId(el, 'signer-pur-1')?.textContent).toContain('Signed');
    await openTerms(http, fixture, el);
    byTestId(document, 'terms-submit')!.click();
    await settle(fixture);
    const confirm = TestBed.inject(ConfirmService);
    expect(confirm.pending()?.message).toContain('no longer be valid');
    confirm.answer(true);
    await settle(fixture);
    http.expectOne('/api/agreements/a1').flush(
      sent({
        purchasers: [
          purchaser({
            status: SignerStatus.Invalidated,
            invalidatedAt: '2026-11-03T09:00:00.000Z',
          }),
        ],
      }),
    );
    await settle(fixture);
    expect(byTestId(el, 'signer-pur-1')?.textContent).toContain('Must sign again');
  });

  const signed = () =>
    sent({
      status: AgreementStatus.Signed,
      signedAt: '2026-11-03T09:00:00.000Z',
      purchasers: [signedPurchaser()],
    });

  it('sales staff see that it is ready, but cannot countersign', async () => {
    const { el } = await mount(signed());
    expect(byTestId(el, 'signed-banner')?.textContent).toContain('Every purchaser has signed');
    expect(byTestId(el, 'countersign')).toBeNull();
  });

  it('an administrator countersigns, which executes the agreement', async () => {
    const { http, fixture, el } = await mount(signed(), Role.CompanyAdmin, 'Alex Admin');
    byTestId(el, 'countersign')!.click();
    await settle(fixture);
    byTestId<HTMLInputElement>(document, 'countersign-agree')!.click();
    await settle(fixture);
    byTestId(document, 'countersign-submit')!.click();
    await settle(fixture);
    const req = http.expectOne('/api/agreements/a1/countersign');
    expect(req.request.body).toEqual({
      contentHash: agreement().contentHash,
      fullName: 'Alex Admin',
      agree: true,
    });
    req.flush({
      ...signed(),
      status: AgreementStatus.Executed,
      executedAt: '2026-11-04T09:00:00.000Z',
      counterSignature: {
        fullName: 'Alex Admin',
        signedAt: '2026-11-04T09:00:00.000Z',
        contentHash: agreement().contentHash,
        provider: 'built-in',
      },
    });
    await settle(fixture);
    expect(byTestId(el, 'executed-banner')?.textContent).toContain('Executed');
    expect(byTestId(el, 'agreement-status')?.textContent).toContain('Executed');
    expect(byTestId(el, 'cancel')).toBeNull();
  });

  it('a purchaser can be given a new link and code', async () => {
    const { http, fixture, el } = await mount(sent());
    byTestId(el, 'reinvite-pur-1')!.click();
    await settle(fixture);
    http
      .expectOne('/api/agreements/a1/purchasers/pur-1/invite')
      .flush({ purchaserId: 'pur-1', name: 'Robin Buyer', key: 'new-key', code: 'WXYZ-1234' });
    await settle(fixture);
    expect(byTestId(document, 'code-pur-1')?.textContent).toContain('WXYZ-1234');
  });

  it('a sent agreement can be voided with a reason for the buyer', async () => {
    const { http, fixture, el } = await mount(sent());
    byTestId(el, 'cancel')!.click();
    await settle(fixture);
    type(document.querySelector<HTMLInputElement>('#c-reason')!, 'Wrong closing date');
    await settle(fixture);
    byTestId(document, 'confirm-cancel')!.click();
    await settle(fixture);
    const req = http.expectOne('/api/agreements/a1/cancel');
    expect(req.request.body).toEqual({ reason: 'Wrong closing date' });
  });
});
