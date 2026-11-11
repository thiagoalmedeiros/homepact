import {
  AgreementStatus,
  ChangeRequestStatus,
  Party,
  ProposalStatus,
} from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { settle, setup } from '../../testing';
import {
  agreement,
  HOUSE_DETAIL,
  pause,
  proposalDetail,
  quote,
  taxedQuote,
  TAX_RATES,
  TEMPLATES,
} from '../../testing-fixtures';
import { ProposalDetailPage } from './proposal-detail.page';

const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input'));
};

const withRequest = () =>
  proposalDetail(
    { status: ProposalStatus.ChangesRequested, openChangeRequestId: 'cr1' },
    {
      viewerParty: Party.Seller,
      changeRequests: [
        {
          id: 'cr1',
          proposalId: 'p1',
          baseRevision: 1,
          note: 'Can we skip the island?',
          changes: [
            {
              id: 'c1',
              change: { type: 'remove_item', areaSlug: 'kitchen', itemId: 'island' },
              label: 'Remove Island',
              deltaCents: -150_000,
            },
            {
              id: 'c2',
              change: { type: 'add_item', areaSlug: 'exterior', itemId: 'stone' },
              label: 'Add Stone',
              deltaCents: 900_000,
            },
          ],
          previewTotalCents: 61_400_000,
          status: ChangeRequestStatus.Open,
          authorName: 'Robin Buyer',
          createdAt: new Date().toISOString(),
        },
      ],
    },
  );

describe('ProposalDetailPage (seller)', () => {
  it('seller approves or declines each requested change, then sends the next revision', async () => {
    const http = setup();
    const fixture = TestBed.createComponent(ProposalDetailPage);
    fixture.componentRef.setInput('id', 'p1');
    await settle(fixture);
    http.expectOne('/api/proposals/p1').flush(withRequest());
    await settle(fixture);
    await pause();
    http
      .expectOne('/api/proposals/p1/change-requests/preview')
      .flush({ quote: quote(60_650_000), changes: [] });
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Can we skip the island?');
    expect(el.querySelector('[data-testid="review"] h2')?.textContent?.trim()).toBe(
      'Robin Buyer asked for 2 changes',
    );
    const send = el.querySelector<HTMLButtonElement>('[data-testid="send-answer"]')!;
    expect(send.disabled).toBe(true);
    const group = el.querySelector('[data-testid="decision-0"] [role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Decision for Remove Island');

    el.querySelector<HTMLButtonElement>(
      '[data-testid="decision-0"] [data-testid="approve"]',
    )!.click();
    el.querySelector<HTMLButtonElement>(
      '[data-testid="decision-1"] [data-testid="decline"]',
    )!.click();
    await settle(fixture);
    const reason = el.querySelector<HTMLInputElement>('[data-testid="decision-1"] input')!;
    reason.value = 'Backordered';
    reason.dispatchEvent(new Event('input'));
    await settle(fixture);
    await pause();
    const preview = http.expectOne('/api/proposals/p1/change-requests/preview');
    expect(preview.request.body).toEqual({
      changes: [{ type: 'remove_item', areaSlug: 'kitchen', itemId: 'island' }],
      adjustments: [],
    });
    preview.flush({ quote: quote(60_500_000), changes: [] });
    await settle(fixture);
    expect(send.textContent).toContain('Send revision 2');
    expect(el.querySelector('[data-testid="answer-total"]')?.textContent).toContain('605,000');

    send.click();
    await settle(fixture);
    const req = http.expectOne('/api/proposals/p1/change-requests/cr1/decision');
    expect(req.request.body).toEqual({
      decisions: [
        { changeId: 'c1', approved: true },
        { changeId: 'c2', approved: false, note: 'Backordered' },
      ],
      adjustments: [],
    });
  });
});

describe('ProposalDetailPage (revising: sales tax and referral)', () => {
  it('keeps the province and referral, previews on the server and sends what changed', async () => {
    const http = setup();
    const fixture = TestBed.createComponent(ProposalDetailPage);
    fixture.componentRef.setInput('id', 'p1');
    await settle(fixture);
    const current = taxedQuote({
      referral: {
        programId: 'ended',
        programName: 'Spring referral',
        referrerName: 'Jo Homeowner',
        creditCents: 100_000,
      },
    });
    const detail = proposalDetail({}, { viewerParty: Party.Seller });
    detail.revisions[0]!.quote = current;
    http.expectOne('/api/proposals/p1').flush(detail);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="quote-before-tax"]')?.textContent).toContain('$599,500');
    expect(el.querySelector('[data-testid="quote-tax"]')?.textContent).toContain('Alberta');
    expect(el.querySelector('[data-testid="quote-referral"]')?.textContent).toContain(
      'Spring referral: referred by Jo Homeowner',
    );

    el.querySelector<HTMLButtonElement>('[data-testid="revise"]')!.click();
    await settle(fixture);
    http.expectOne('/api/proposals/p1/options').flush(HOUSE_DETAIL);
    http.expectOne('/api/tax-rates').flush(TAX_RATES);
    http.expectOne('/api/referral-programs').flush([
      {
        id: 'friends',
        name: 'Refer a friend',
        creditCents: 200_000,
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    await settle(fixture);
    await pause();
    let preview = http.expectOne('/api/proposals/p1/revisions/preview');
    expect(preview.request.body).toEqual({
      selections: { kitchen: { packageId: 'chef' } },
      adjustments: [],
      taxRegion: 'AB',
      referral: { programId: 'ended', referrerName: 'Jo Homeowner' },
    });
    preview.flush(current);
    await settle(fixture);
    const program = el.querySelector<HTMLSelectElement>('[data-testid="referral-program"]')!;
    expect([...program.options].map((o) => o.textContent?.trim())).toEqual([
      'Refer a friend · −$2,000 credit',
      'Spring referral · −$1,000 credit',
    ]);
    expect(program.value).toBe('ended');

    const region = el.querySelector<HTMLSelectElement>('[data-testid="tax-region"]')!;
    expect([...region.options].map((o) => o.value)).toEqual(['AB', 'ON', '']);
    region.value = 'ON';
    region.dispatchEvent(new Event('change'));
    el.querySelector<HTMLInputElement>('[data-testid="referral-toggle"]')!.click();
    await settle(fixture);
    await pause();
    preview = http.expectOne('/api/proposals/p1/revisions/preview');
    expect(preview.request.body).toMatchObject({ taxRegion: 'ON', referral: null });
    preview.flush(
      taxedQuote({
        tax: {
          regionCode: 'ON',
          regionName: 'Ontario',
          lines: [{ label: 'HST', ratePercent: 13, amountCents: 7_884_500 }],
          totalCents: 7_884_500,
        },
        subtotalCents: 60_650_000,
        totalCents: 68_534_500,
      }),
    );
    await settle(fixture);
    expect(el.querySelector('[data-testid="revise-total"]')?.textContent).toContain('$685,345');
    expect(el.querySelector('[data-testid="revise-tax"]')?.textContent).toContain(
      '$606,500 before tax + $78,845 sales tax (Ontario)',
    );

    el.querySelector<HTMLButtonElement>('[data-testid="send-revision"]')!.click();
    await settle(fixture);
    const sent = http.expectOne('/api/proposals/p1/revisions');
    expect(sent.request.body).toEqual({
      selections: { kitchen: { packageId: 'chef' } },
      adjustments: [],
      taxRegion: 'ON',
      referral: null,
    });
  });
});

describe('ProposalDetailPage (signed proposal → purchase agreement)', () => {
  const signed = (extra = {}) =>
    proposalDetail(
      {
        status: ProposalStatus.Signed,
        signature: {
          fullName: 'Robin Buyer',
          revision: 1,
          totalCents: 60_650_000,
          signedAt: '2026-10-30T15:00:00.000Z',
        },
      },
      { viewerParty: Party.Seller, ...extra },
    );
  const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
    root.querySelector<T>(`[data-testid="${id}"]`);

  const mount = async (detail = signed()) => {
    const http = setup();
    const fixture = TestBed.createComponent(ProposalDetailPage);
    fixture.componentRef.setInput('id', 'p1');
    await settle(fixture);
    http.expectOne('/api/proposals/p1').flush(detail);
    await settle(fixture);
    return { http, fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('the seller prepares a draft from the default template, then reviews it', async () => {
    const { http, fixture, el } = await mount();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    byTestId(el, 'prepare-agreement')!.click();
    await settle(fixture);
    http.expectOne('/api/agreement-templates').flush(TEMPLATES);
    await settle(fixture);
    await fixture.whenStable();
    await settle(fixture);
    expect(byTestId<HTMLSelectElement>(document, 'terms-template')!.value).toBe('t2');
    expect(byTestId<HTMLInputElement>(document, 'purchaser-name-0')!.value).toBe('Robin Buyer');

    byTestId(document, 'add-purchaser')!.click();
    await settle(fixture);
    type(byTestId<HTMLInputElement>(document, 'purchaser-name-1')!, 'Sam Buyer');
    type(byTestId<HTMLInputElement>(document, 'purchaser-email-1')!, 'sam@example.com');
    type(byTestId<HTMLInputElement>(document, 'deposit-amount-0')!, '20000');
    byTestId(document, 'add-deposit')!.click();
    await settle(fixture);
    type(byTestId<HTMLInputElement>(document, 'deposit-label-1')!, 'on the 30th day');
    type(byTestId<HTMLInputElement>(document, 'deposit-amount-1')!, '10000');
    type(byTestId<HTMLInputElement>(document, 'deposit-due-1')!, '2027-01-30');
    byTestId(document, 'condition-preset-0')!.click();
    await settle(fixture);
    type(byTestId<HTMLInputElement>(document, 'terms-closing')!, '2027-03-15');
    await settle(fixture);
    expect(byTestId(document, 'deposit-total')!.textContent).toContain(
      'Deposit $30,000 of $606,500',
    );
    byTestId(document, 'terms-submit')!.click();
    await settle(fixture);

    const req = http.expectOne('/api/agreements');
    expect(req.request.body).toEqual({
      proposalId: 'p1',
      templateId: 't2',
      purchasers: [{ name: 'Robin Buyer' }, { name: 'Sam Buyer', email: 'sam@example.com' }],
      deposits: [
        { label: 'on signing', amountCents: 2_000_000 },
        { label: 'on the 30th day', amountCents: 1_000_000, dueDate: '2027-01-30' },
      ],
      conditions: [{ label: 'Financing', details: expect.stringContaining('mortgage') }],
      closingDate: '2027-03-15',
    });
    req.flush(agreement());
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith(['/console/agreements', 'a1']);
  });

  it('once prepared, the proposal links to its agreement', async () => {
    const { el } = await mount(
      signed({
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
          signedCount: 0,
          purchaserCount: 2,
        },
      }),
    );
    const card = byTestId(el, 'agreement-card')!;
    expect(card.textContent).toContain('Purchase agreement A-2001');
    expect(card.textContent).toContain('Out for signature');
    expect(byTestId(el, 'open-agreement')!.getAttribute('href')).toBe('/console/agreements/a1');
    expect(byTestId(el, 'prepare-agreement')).toBeNull();
  });

  it('a proposal that is not signed has no agreement step', async () => {
    const { el } = await mount(proposalDetail({}, { viewerParty: Party.Seller }));
    expect(byTestId(el, 'agreement-card')).toBeNull();
  });
});
