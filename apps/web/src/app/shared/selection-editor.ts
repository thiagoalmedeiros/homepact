import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import type { ConfiguratorArea, Selection, Selections } from '@homepact/shared';
import type { Currency } from '@homepact/shared/format';
import { MoneyPipe } from './money.pipe';

type Mode = 'package' | 'items';

const sameSelection = (a: Selection | undefined, b: Selection | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Items that can be chosen one by one (the rest are only sold inside packages). */
export const looseItems = (area: ConfiguratorArea) =>
  area.items.filter((i) => i.soldSeparately !== false);

/** What an area currently costs on top of the base price. */
export const areaCost = (area: ConfiguratorArea, sel: Selection | undefined): number => {
  if (!sel) return 0;
  if ('packageId' in sel) return area.packages.find((p) => p.id === sel.packageId)?.priceCents ?? 0;
  return area.items.filter((i) => sel.itemIds.includes(i.id)).reduce((t, i) => t + i.priceCents, 0);
};

/** Tile picker for a house's options: one package or individual items per area; `base` flags
 * what changed. */
@Component({
  selector: 'hc-selection-editor',
  imports: [MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './selection-editor.html',
  styleUrl: './selection-editor.scss',
})
export class SelectionEditor {
  protected choiceLabel(area: string): string {
    return $localize`:@@selection.choice:${area}:area: choice`;
  }

  readonly areas = input.required<ConfiguratorArea[]>();
  readonly currency = input<Currency>('CAD');
  readonly base = input<Selections | null>(null);
  readonly selections = model.required<Selections>();
  private readonly modes = signal<Record<string, Mode>>({});

  protected readonly areaCost = areaCost;
  protected readonly looseItems = looseItems;
  protected readonly changedAreas = computed(() => {
    const base = this.base();
    if (!base) return new Set<string>();
    const next = this.selections();
    return new Set(
      this.areas()
        .map((a) => a.slug)
        .filter((s) => !sameSelection(base[s], next[s])),
    );
  });

  protected changed(slug: string): boolean {
    return this.changedAreas().has(slug);
  }

  protected modeOf(area: ConfiguratorArea): Mode {
    const explicit = this.modes()[area.slug];
    if (explicit) return explicit;
    const sel = this.selections()[area.slug];
    if (sel) return 'packageId' in sel ? 'package' : 'items';
    return area.packages.length || !looseItems(area).length ? 'package' : 'items';
  }

  protected isPackage(sel: Selection | undefined, id: string): boolean {
    return !!sel && 'packageId' in sel && sel.packageId === id;
  }

  protected hasItem(sel: Selection | undefined, id: string): boolean {
    return !!sel && 'itemIds' in sel && sel.itemIds.includes(id);
  }

  protected inBase(area: ConfiguratorArea, itemId: string): boolean {
    const b = this.base()?.[area.slug];
    if (!b) return false;
    if ('itemIds' in b) return b.itemIds.includes(itemId);
    return area.packages.find((p) => p.id === b.packageId)?.itemIds.includes(itemId) ?? false;
  }

  /** Switching a package area to individual options keeps the package's items selected. */
  protected setMode(area: ConfiguratorArea, mode: Mode): void {
    this.modes.update((m) => ({ ...m, [area.slug]: mode }));
    const sel = this.selections()[area.slug];
    if (mode === 'items' && sel && 'packageId' in sel) {
      const offered = new Set(looseItems(area).map((i) => i.id));
      const itemIds = (area.packages.find((p) => p.id === sel.packageId)?.itemIds ?? []).filter(
        (id) => offered.has(id),
      );
      this.write(area.slug, itemIds.length ? { itemIds } : undefined);
    }
  }

  protected pickPackage(slug: string, id: string): void {
    const sel = this.selections()[slug];
    this.write(slug, this.isPackage(sel, id) ? undefined : { packageId: id });
  }

  protected toggleItem(area: ConfiguratorArea, id: string): void {
    const sel = this.selections()[area.slug];
    const current = sel && 'itemIds' in sel ? sel.itemIds : [];
    const itemIds = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    this.write(area.slug, itemIds.length ? { itemIds } : undefined);
  }

  private write(slug: string, sel: Selection | undefined): void {
    this.selections.update((all) => {
      const next = { ...all };
      if (sel) next[slug] = sel;
      else delete next[slug];
      return next;
    });
  }
}
