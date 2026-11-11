import { AgreementStatus, SignerStatus } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { ToastService } from '../../core/toast.service';
import { settle, setup } from '../../testing';
import { agreement, HASH, purchaser, signedPurchaser } from '../../testing-fixtures';
import { AgreementRoomPage } from './agreement-room.page';

/** Sent to two purchasers; this session is Robin's signing link. */
const sent = (overrides = {}) =>
  agreement({
    status: AgreementStatus.UnderReview,
    issuedAt: '2026-11-02T10:00:00.000Z',
    issuedByName: 'Jordan Blake',
    purchasers: [
      purchaser({ invitedAt: '2026-11-02T10:00:00.000Z' }),
      purchaser({ id: 'pur-2', name: 'Sam Buyer', email: 'sam@example.com' }),
    ],
    viewerPurchaserId: 'pur-1',
    ...overrides,
  });

const mount = async (body: object = sent(), status = 200) => {
  const http = setup();
  const fixture = TestBed.createComponent(AgreementRoomPage);
  fixture.componentRef.setInput('id', 'a1');
  await settle(fixture);
  http
    .expectOne('/api/agreements/a1')
    .flush(body, status === 200 ? {} : { status, statusText: 'Not Found' });
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};
const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);

describe('AgreementRoomPage (purchaser)', () => {
  it('a purchaser initials the key clauses and signs exactly that content', async () => {
    const { http, fixture, el } = await mount();
    expect(byTestId(el, 'to-sign')?.textContent).toContain('Example Homes sent you this agreement');
    const doc = byTestId(el, 'agreement-document')!;
    expect(doc.textContent).toContain('Agreement of purchase and sale');
    expect(doc.textContent).toContain('The purchase price is $606,500.');
    expect(doc.textContent).toContain('March 15, 2027');
    expect(doc.textContent).toContain('Financing');
    expect(byTestId(el, 'other-purchasers')?.textContent).toContain('Sam Buyer');
    expect(byTestId(doc, 'signature-pur-1')?.textContent).toContain('Not signed yet');
    expect(byTestId(doc, 'signature-seller')?.textContent).toContain('Not signed yet');

    expect(byTestId<HTMLButtonElement>(el, 'open-sign-agreement')!.disabled).toBe(true);
    expect(byTestId(el, 'initials-hint')?.textContent).toContain('Initial the 1 key clause');
    byTestId<HTMLInputElement>(doc, 'initial-2')!.querySelector('input')!.click();
    await settle(fixture);
    expect(byTestId<HTMLButtonElement>(el, 'open-sign-agreement')!.disabled).toBe(false);

    byTestId(el, 'open-sign-agreement')!.click();
    await settle(fixture);
    const name = byTestId<HTMLInputElement>(document, 'agreement-sign-name')!;
    expect(name.value).toBe('Robin Buyer');
    const submit = byTestId<HTMLButtonElement>(document, 'agreement-sign-submit')!;
    expect(submit.disabled).toBe(true);
    byTestId<HTMLInputElement>(document, 'agreement-sign-agree')!.click();
    await settle(fixture);
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle(fixture);

    const req = http.expectOne('/api/agreements/a1/sign');
    expect(req.request.body).toEqual({
      contentHash: HASH,
      fullName: 'Robin Buyer',
      initials: [2],
      agree: true,
    });
    req.flush(
      sent({
        purchasers: [
          signedPurchaser({ invitedAt: '2026-11-02T10:00:00.000Z' }),
          purchaser({ id: 'pur-2', name: 'Sam Buyer' }),
        ],
      }),
    );
    await settle(fixture);
    expect(byTestId(el, 'you-signed')?.textContent).toContain('You signed this agreement');
    expect(byTestId(el, 'open-sign-agreement')).toBeNull();
    expect(byTestId(el, 'signature-pur-1')?.textContent).toContain('Signed electronically');
  });

  it('a signature that a change invalidated has to be given again', async () => {
    const { el } = await mount(
      sent({
        purchasers: [
          purchaser({
            status: SignerStatus.Invalidated,
            invalidatedAt: '2026-11-03T09:00:00.000Z',
          }),
        ],
      }),
    );
    expect(byTestId(el, 'sign-again')?.textContent).toContain('A clause changed after you signed');
    expect(byTestId<HTMLButtonElement>(el, 'open-sign-agreement')).not.toBeNull();
  });

  it('someone who is not a signer reads it but cannot sign', async () => {
    const { el } = await mount(sent({ viewerPurchaserId: undefined }));
    expect(byTestId(el, 'out-for-signature')).not.toBeNull();
    expect(byTestId(el, 'open-sign-agreement')).toBeNull();
  });

  it('an executed agreement shows the countersignature and keeps the PDF', async () => {
    const { el } = await mount(
      sent({
        status: AgreementStatus.Executed,
        signedAt: '2026-11-03T09:00:00.000Z',
        executedAt: '2026-11-04T09:00:00.000Z',
        purchasers: [signedPurchaser(), signedPurchaser({ id: 'pur-2', name: 'Sam Buyer' })],
        counterSignature: {
          fullName: 'Alex Admin',
          signedAt: '2026-11-04T09:00:00.000Z',
          contentHash: HASH,
          provider: 'built-in',
        },
      }),
    );
    expect(byTestId(el, 'agreement-executed')?.textContent).toContain('executed');
    expect(byTestId(el, 'signature-seller')?.textContent).toContain('Alex Admin');
    expect(byTestId(el, 'open-sign-agreement')).toBeNull();
  });

  it('downloads the PDF through the API, which checks the origin and the session', async () => {
    const created = vi.fn(() => 'blob:agreement');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { http, fixture, el } = await mount();

    byTestId(el, 'download-agreement')!.click();
    await settle(fixture);
    const req = http.expectOne('/api/agreements/a1/pdf');
    expect(req.request.responseType).toBe('blob');
    expect(req.request.headers.has('Authorization')).toBe(false); // no session in this test
    const pdf = new Blob(['%PDF-1.3'], { type: 'application/pdf' });
    req.flush(pdf);
    await settle(fixture);
    expect(created).toHaveBeenCalledWith(pdf);
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('A-2001-for-signature.pdf');
    click.mockRestore();
  });

  it('a refused download shows the API’s message, not a blob', async () => {
    const { http, fixture, el } = await mount();
    byTestId(el, 'download-agreement')!.click();
    await settle(fixture);
    http
      .expectOne('/api/agreements/a1/pdf')
      .flush(new Blob([JSON.stringify({ error: 'Not found' })], { type: 'application/json' }), {
        status: 404,
        statusText: 'Not Found',
      });
    await settle(fixture);
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((t) => t.text),
    ).toEqual(['Not found']);
  });

  it('a voided agreement can be read but not signed', async () => {
    const { el } = await mount(
      sent({
        status: AgreementStatus.Cancelled,
        cancelledAt: '2026-11-04T10:00:00.000Z',
        cancelReason: 'Wrong closing date',
      }),
    );
    expect(byTestId(el, 'agreement-cancelled')?.textContent).toContain('Wrong closing date');
    expect(byTestId(el, 'open-sign-agreement')).toBeNull();
  });

  it('an agreement that is not theirs is simply unavailable', async () => {
    const { el } = await mount({ error: 'Not found' }, 404);
    expect(el.textContent).toContain("This agreement isn't available");
  });
});
