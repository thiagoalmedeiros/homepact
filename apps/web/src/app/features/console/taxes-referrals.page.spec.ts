import { Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import type { ReferralProgram, TaxPreset } from '@homepact/shared';
import { settle, setup, signInAs } from '../../testing';
import { TAX_RATES } from '../../testing-fixtures';
import { TaxesReferralsPage } from './taxes-referrals.page';

const PROGRAMS: ReferralProgram[] = [
  {
    id: 'prog-1',
    name: 'Homeowner referral',
    description: 'The referrer gets a thank-you on closing.',
    creditCents: 200_000,
    active: true,
    createdAt: '',
    updatedAt: '',
  },
];

const PRESETS: TaxPreset[] = [
  {
    id: 'preset-ab',
    code: 'AB',
    name: 'Alberta',
    components: [{ label: 'GST', ratePercent: 5 }],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'preset-qc',
    code: 'QC',
    name: 'Quebec',
    components: [
      { label: 'GST', ratePercent: 5 },
      { label: 'QST', ratePercent: 9.975 },
    ],
    note: 'QST applies to new homes.',
    createdAt: '',
    updatedAt: '',
  },
];

const type = (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  )!;

const open = async (role: Role) => {
  const http = setup();
  await signInAs(http, role, 'Morgan Reyes');
  const fixture = TestBed.createComponent(TaxesReferralsPage);
  await settle(fixture);
  http.expectOne('/api/tax-rates').flush(TAX_RATES);
  http.expectOne('/api/referral-programs').flush(PROGRAMS);
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
};

describe('TaxesReferralsPage', () => {
  it('lists the provinces with their taxes and the referral programs', async () => {
    const { el } = await open(Role.CompanyAdmin);
    const alberta = el.querySelector('[data-testid="rate-AB"]')!;
    expect(alberta.textContent).toContain('Alberta');
    expect(alberta.textContent).toContain('GST 5%');
    expect(alberta.textContent).toContain('Default');
    expect(alberta.textContent).toContain("From the platform's suggestions");
    expect(el.querySelector('[data-testid="rate-ON"]')?.textContent).toContain('Make default');
    const program = el.querySelector('[data-testid="program-prog-1"]')!;
    expect(program.textContent).toContain('Homeowner referral');
    expect(program.textContent).toContain('−$2,000');
  });

  it('an administrator adopts a suggestion of the platform instead of typing it', async () => {
    const { http, fixture, el } = await open(Role.CompanyAdmin);
    el.querySelector<HTMLButtonElement>('[data-testid="open-suggestions"]')!.click();
    await settle(fixture);
    http.expectOne('/api/tax-presets').flush(PRESETS);
    await settle(fixture);
    const ab = document.querySelector('[data-testid="suggestion-AB"]')!;
    expect(ab.textContent).toContain('Added');
    const qc = document.querySelector('[data-testid="suggestion-QC"]')!;
    expect(qc.textContent).toContain('GST 5% + QST 9.975%');
    expect(qc.textContent).toContain('QST applies to new homes.');
    button(qc, 'Use').click();
    await settle(fixture);
    const req = http.expectOne('/api/tax-rates/adopt');
    expect(req.request.body).toEqual({ presetId: 'preset-qc' });
  });

  it('an administrator enters a province with their own rates', async () => {
    const { http, fixture, el } = await open(Role.CompanyAdmin);
    el.querySelector<HTMLButtonElement>('[data-testid="new-rate"]')!.click();
    await settle(fixture);
    const save = document.querySelector<HTMLButtonElement>('[data-testid="save-rate"]')!;
    expect(save.disabled).toBe(true);
    type('#r-name', 'Nova Scotia');
    type('#r-code', 'ns');
    type('[data-testid="tax-component-0"] input:not([type])', 'HST');
    type('[data-testid="tax-component-0"] input[type="number"]', '14');
    await settle(fixture);
    expect(save.disabled).toBe(false);
    document.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/tax-rates');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      code: 'NS',
      name: 'Nova Scotia',
      components: [{ label: 'HST', ratePercent: 14 }],
      isDefault: false,
    });
  });

  it('an administrator makes a province the default and creates a referral program', async () => {
    const { http, fixture, el } = await open(Role.CompanyAdmin);
    button(el.querySelector('[data-testid="rate-ON"]')!, 'Make default').click();
    await settle(fixture);
    const put = http.expectOne('/api/tax-rates/tax-on');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toMatchObject({ code: 'ON', isDefault: true });
    put.flush(TAX_RATES[1]!);
    await settle(fixture);
    http.expectOne('/api/tax-rates').flush(TAX_RATES);

    el.querySelector<HTMLButtonElement>('[data-testid="new-program"]')!.click();
    await settle(fixture);
    type('#p-name', 'Refer a friend');
    type('#p-credit', '1500');
    type('#p-desc', 'Both friends get a gift.');
    await settle(fixture);
    document.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/referral-programs');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'Refer a friend',
      description: 'Both friends get a gift.',
      creditCents: 150_000,
      active: true,
    });
  });

  it('sales staff see the settings but cannot change them', async () => {
    const { el } = await open(Role.CompanyStaff);
    expect(el.querySelector('[data-testid="open-suggestions"]')).toBeNull();
    expect(el.querySelector('[data-testid="new-rate"]')).toBeNull();
    expect(el.querySelector('[data-testid="new-program"]')).toBeNull();
    expect(el.textContent).not.toContain('Make default');
    expect(
      el.querySelector<HTMLInputElement>('[data-testid="program-prog-1"] input.switch')!.disabled,
    ).toBe(true);
  });
});
