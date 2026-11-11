import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Selections } from '@homepact/shared';
import { settle, setup } from '../testing';
import { HOUSE_DETAIL } from '../testing-fixtures';
import { SelectionEditor } from './selection-editor';

@Component({
  imports: [SelectionEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<hc-selection-editor [areas]="areas" [base]="base()" [(selections)]="value" />`,
})
class Host {
  readonly areas = HOUSE_DETAIL.areas;
  readonly base = signal<Selections | null>(null);
  readonly value = signal<Selections>({});
}

const click = (el: HTMLElement, testId: string) =>
  el.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click();

describe('SelectionEditor', () => {
  it('picks a package, or individual options that start from the package contents', async () => {
    setup();
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    click(el, 'package-chef');
    await settle(fixture);
    expect(fixture.componentInstance.value()).toEqual({ kitchen: { packageId: 'chef' } });

    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Individual options'))!
      .click();
    await settle(fixture);
    expect(fixture.componentInstance.value()).toEqual({
      kitchen: { itemIds: ['quartz', 'island'] },
    });

    click(el, 'item-island');
    click(el, 'item-stone');
    await settle(fixture);
    expect(fixture.componentInstance.value()).toEqual({
      kitchen: { itemIds: ['quartz'] },
      exterior: { itemIds: ['stone'] },
    });
  });

  it('marks what is already in the proposal and what the buyer changed', async () => {
    setup();
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.base.set({ kitchen: { packageId: 'chef' } });
    fixture.componentInstance.value.set({ kitchen: { packageId: 'chef' } });
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Current');
    expect(el.querySelector('[data-testid="changed"]')).toBeNull();
    click(el, 'item-stone');
    await settle(fixture);
    expect(el.querySelectorAll('[data-testid="changed"]').length).toBe(1);
  });
});
