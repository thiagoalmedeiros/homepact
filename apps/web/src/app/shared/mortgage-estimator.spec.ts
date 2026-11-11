import { TestBed } from '@angular/core/testing';
import type { MortgageReferenceRate } from '@homepact/shared';
import { settle, setup } from '../testing';
import { MortgageEstimator } from './mortgage-estimator';

const REFERENCE: MortgageReferenceRate = {
  seriesId: 'V80691335',
  source: 'Bank of Canada',
  sourceUrl: 'https://www.bankofcanada.ca/valet/series/V80691335',
  ratePercent: 5,
  asOf: '2026-11-04',
  history: [
    { date: '2025-11-05', ratePercent: 6.4 },
    { date: '2026-05-06', ratePercent: 5.6 },
    { date: '2026-11-04', ratePercent: 5 },
  ],
};

const render = async (reference: MortgageReferenceRate | null, regionCode = 'ON') => {
  const http = setup();
  const fixture = TestBed.createComponent(MortgageEstimator);
  fixture.componentRef.setInput('priceCents', 62_500_000);
  fixture.componentRef.setInput('regionCode', regionCode);
  await settle(fixture);
  http.expectOne('/api/market-rates/mortgage').flush(reference);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const text = (id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
  const set = async (id: string, value: string, event = 'input') => {
    const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-testid="${id}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event(event));
    await settle(fixture);
  };
  return { el, text, set };
};

describe('MortgageEstimator', () => {
  it('starts at the posted rate with 20% down, and shows the rate trend and its source', async () => {
    const { el, text } = await render(REFERENCE);
    expect(text('reference-rate')).toContain('5.00%');
    expect(el.querySelector('[data-testid="rate-sparkline"] polyline')).not.toBeNull();
    expect(el.querySelector('[data-testid="rate-sparkline"]')?.getAttribute('aria-label')).toBe(
      'Posted 5-year rate over the last 12 months, from 6.4% to 5%',
    );
    expect(text('down-payment')).toContain('$125,000');
    expect(text('mortgage')).toContain('$500,000');
    expect(text('payment')).toContain('$2,908.02');
    expect(el.querySelector('[data-testid="insurance"]')).toBeNull();
    expect(text('mortgage-disclaimer')).toContain('Bank of Canada');
    expect(text('mortgage-disclaimer')).toContain('November 4, 2026');
  });

  it('adds mortgage insurance below 20% down, and its provincial tax apart', async () => {
    const { text, set } = await render(REFERENCE);
    await set('down-percent', '10');
    expect(text('down-payment')).toContain('$62,500');
    expect(text('insurance')).toContain('3.10%');
    expect(text('insurance')).toContain('$17,437.50');
    expect(text('premium-tax')).toContain('$1,395');
    expect(text('mortgage')).toContain('$579,937.50');
  });

  it('warns under the minimum down payment', async () => {
    const { el, text, set } = await render(REFERENCE);
    await set('down-percent', '5');
    expect(text('below-minimum')).toContain('$37,500');
    expect(el.querySelector('.payment.dim')).not.toBeNull();
  });

  it("prices the buyer's own rate, frequency and amortization, then the posted rate again", async () => {
    const { el, text, set } = await render(REFERENCE, 'AB');
    await set('rate', '4.5');
    await set('frequency', 'weekly', 'change');
    await set('amortization', '30', 'change');
    expect(text('payment')).toContain('$580.96');
    expect(el.querySelector('.payment')?.textContent).toContain('per week');
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Use the posted rate'))!
      .click();
    await settle();
    await set('frequency', 'weekly', 'change');
    expect(text('payment')).toContain('$614.82');
  });

  it('without a posted rate the buyer types theirs', async () => {
    const { el, text } = await render(null);
    expect(el.querySelector('[data-testid="reference-rate"]')).toBeNull();
    expect(text('mortgage-disclaimer')).toContain('not available right now');
    expect((el.querySelector('[data-testid="rate"]') as HTMLInputElement).value).toBe('5');
  });
});
