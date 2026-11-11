import { AgreementStatus, ChangeRequestStatus, ProposalStatus } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { settle, setup } from '../../testing';
import { HOUSE_DETAIL, pause, proposalDetail, quote } from '../../testing-fixtures';
import { ProposalRoomPage } from './proposal-room.page';

const mount = async (detail = proposalDetail()) => {
  const http = setup();
  const fixture = TestBed.createComponent(ProposalRoomPage);
  fixture.componentRef.setInput('id', 'p1');
  await settle(fixture);
  http.expectOne('/api/proposals/p1').flush(detail);
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};
const byTestId = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('ProposalRoomPage', () => {
  it('a locked pre-existing home can be signed but not changed', async () => {
    const { el } = await mount(
      proposalDetail({ kind: 'inventory', locked: true, address: '140 Sample Common SE' }),
    );
    expect(byTestId(el, 'locked-banner')?.textContent).toContain('offered as built');
    expect(byTestId(el, 'request-changes')).toBeNull();
    expect(byTestId(el, 'open-sign')).not.toBeNull();
  });

  it('buyer edits the configuration and sends the resulting change list', async () => {
    const { http, fixture, el } = await mount();
    byTestId(el, 'request-changes')!.click();
    await settle(fixture);
    http.expectOne('/api/proposals/p1/options').flush(HOUSE_DETAIL);
    await settle(fixture);

    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Individual options'))!
      .click();
    await settle(fixture);
    byTestId(el, 'item-island')!.click();
    await settle(fixture);
    await pause();
    const preview = http.expectOne('/api/proposals/p1/change-requests/preview');
    expect(preview.request.body).toEqual({
      changes: [{ type: 'remove_item', areaSlug: 'kitchen', itemId: 'island' }],
    });
    preview.flush({
      quote: quote(60_500_000),
      changes: [{ label: 'Remove Island from Chef package (Kitchen)', deltaCents: -150_000 }],
    });
    await settle(fixture);
    expect(byTestId(el, 'change-total')?.textContent).toContain('605,000');

    byTestId(el, 'review-changes')!.click();
    await settle(fixture);
    expect(document.body.textContent).toContain('Remove Island from Chef package');
    (document.querySelector('[data-testid="send-request"]') as HTMLButtonElement).click();
    await settle(fixture);
    const sent = http.expectOne('/api/proposals/p1/change-requests');
    expect(sent.request.body).toEqual({
      baseRevision: 1,
      changes: [{ type: 'remove_item', areaSlug: 'kitchen', itemId: 'island' }],
    });
    sent.flush(
      proposalDetail(
        { status: ProposalStatus.ChangesRequested, openChangeRequestId: 'cr1' },
        {
          changeRequests: [
            {
              id: 'cr1',
              proposalId: 'p1',
              baseRevision: 1,
              changes: [
                {
                  id: 'c1',
                  change: { type: 'remove_item', areaSlug: 'kitchen', itemId: 'island' },
                  label: 'Remove Island',
                  deltaCents: -150_000,
                },
              ],
              previewTotalCents: 60_500_000,
              status: ChangeRequestStatus.Open,
              authorName: 'Robin Buyer',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ),
    );
    await settle(fixture);
    expect(byTestId(el, 'waiting')?.textContent).toContain('Waiting for Jordan');
    expect(byTestId(el, 'open-sign')).toBeNull();
  });

  it('signing needs the full name and explicit agreement', async () => {
    const { http, fixture, el } = await mount();
    byTestId(el, 'open-sign')!.click();
    await settle(fixture);
    const submit = document.querySelector<HTMLButtonElement>('[data-testid="sign-submit"]')!;
    expect(submit.disabled).toBe(true);
    const agree = document.querySelector<HTMLInputElement>('[data-testid="sign-agree"]')!;
    agree.click();
    await settle(fixture);
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle(fixture);
    const req = http.expectOne('/api/proposals/p1/sign');
    expect(req.request.body).toEqual({ revision: 1, fullName: 'Robin Buyer', agree: true });
    req.flush(
      proposalDetail({
        status: ProposalStatus.Signed,
        signature: {
          fullName: 'Robin Buyer',
          revision: 1,
          totalCents: 60_650_000,
          signedAt: new Date().toISOString(),
        },
      }),
    );
    await settle(fixture);
    expect(byTestId(el, 'signed-banner')?.textContent).toContain('You signed this proposal');
  });

  it('once the seller sends the purchase agreement, the buyer is pointed to it', async () => {
    const { el } = await mount(
      proposalDetail(
        {
          status: ProposalStatus.Signed,
          signature: {
            fullName: 'Robin Buyer',
            revision: 1,
            totalCents: 60_650_000,
            signedAt: new Date().toISOString(),
          },
        },
        {
          agreement: {
            id: 'a1',
            reference: 'A-2001',
            status: AgreementStatus.UnderReview,
            proposalId: 'p1',
            proposalReference: 'P-1001',
            buyerName: 'Robin Buyer',
            houseName: 'Alder',
            totalCents: 60_650_000,
            currency: 'CAD',
            createdAt: '',
            updatedAt: '',
            issuedAt: new Date().toISOString(),
            signedCount: 0,
            purchaserCount: 1,
          },
        },
      ),
    );
    const card = byTestId(el, 'room-agreement')!;
    expect(card.textContent).toContain('Your purchase agreement is ready to sign');
    expect(card.textContent).toContain('Jordan sent it for Example Homes');
    const link = byTestId(el, 'open-room-agreement')!;
    expect(link.textContent).toContain('Review and sign');
    expect(link.getAttribute('href')).toBe('/agreements/a1');
  });
});
