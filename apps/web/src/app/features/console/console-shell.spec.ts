import { Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { settle, setup, signInAs } from '../../testing';
import { ConsoleShell } from './console-shell';

const menuOf = async (role: Role, name: string) => {
  const http = setup();
  await signInAs(http, role, name);
  const fixture = TestBed.createComponent(ConsoleShell);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  return {
    items: [...el.querySelectorAll('.side-nav a')].map((a) => a.textContent?.trim()),
    who: el.querySelector('.who')?.textContent,
  };
};

describe('ConsoleShell', () => {
  it('finance works from payments, agreements and the team list only', async () => {
    const { items, who } = await menuOf(Role.CompanyFinance, 'Riley Chen');
    expect(items).toEqual(['Payments', 'Agreements', 'Team']);
    expect(who).toContain('Finance');
  });

  it('sales keep their menu and can follow the payments they recorded', async () => {
    const { items, who } = await menuOf(Role.CompanyStaff, 'Jordan Blake');
    expect(items).toContain('Proposals');
    expect(items).toContain('Payments');
    expect(who).toContain('Sales');
  });
});
