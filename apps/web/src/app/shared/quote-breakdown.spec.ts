import { TestBed } from '@angular/core/testing';
import type { QuoteSnapshot } from '@homepact/shared';
import { settle, setup } from '../testing';
import { quote, taxedQuote } from '../testing-fixtures';
import { QuoteBreakdown } from './quote-breakdown';

const render = async (q: QuoteSnapshot) => {
  setup();
  const fixture = TestBed.createComponent(QuoteBreakdown);
  fixture.componentRef.setInput('quote', q);
  await settle(fixture);
  return fixture.nativeElement as HTMLElement;
};

describe('QuoteBreakdown', () => {
  it('shows the referral credit, the price before tax, each tax of the province and the total', async () => {
    const el = await render(
      taxedQuote({
        referral: {
          programId: 'p',
          programName: 'Homeowner referral',
          referrerName: 'Dana Whitfield',
          creditCents: 200_000,
        },
        subtotalCents: 58_450_000,
        tax: {
          regionCode: 'QC',
          regionName: 'Quebec',
          lines: [
            { label: 'GST', ratePercent: 5, amountCents: 2_922_500 },
            { label: 'QST', ratePercent: 9.975, amountCents: 5_830_388 },
          ],
          totalCents: 8_752_888,
        },
        totalCents: 67_202_888,
      }),
    );
    expect(el.querySelector('[data-testid="quote-referral"]')?.textContent).toMatch(
      /Homeowner referral: referred by Dana Whitfield\s*−\$2,000/,
    );
    expect(el.querySelector('[data-testid="quote-before-tax"]')?.textContent).toContain('$584,500');
    const tax = el.querySelector('[data-testid="quote-tax"]')!.textContent!;
    expect(tax).toContain('Sales tax · Quebec');
    expect(tax).toMatch(/GST \(5%\)\s*\$29,225/);
    expect(tax).toMatch(/QST \(9\.975%\)\s*\$58,303\.88/);
    expect(el.textContent).toContain('Total, sales tax included');
    expect(el.querySelector('[data-testid="quote-total"]')?.textContent).toContain('$672,028.88');
  });

  it('says so when no sales tax applies', async () => {
    const el = await render({ ...quote(60_650_000), subtotalCents: 60_650_000 });
    expect(el.querySelector('[data-testid="quote-tax"]')?.textContent).toContain('No sales tax');
    expect(el.querySelector('[data-testid="quote-referral"]')).toBeNull();
    expect(el.textContent).not.toContain('sales tax included');
  });

  it('a quote priced before sales tax existed shows its total only', async () => {
    const el = await render(quote(60_650_000));
    expect(el.querySelector('[data-testid="quote-before-tax"]')).toBeNull();
    expect(el.querySelector('[data-testid="quote-tax"]')).toBeNull();
    expect(el.querySelector('[data-testid="quote-total"]')?.textContent).toContain('$606,500');
  });
});
