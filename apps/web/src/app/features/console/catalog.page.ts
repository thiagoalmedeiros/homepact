import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Area, Catalog, CatalogItem, Package } from '@homepact/shared';
import { TenantService as TenantForCurrency } from '../../core/tenant.service';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { MoneyPipe, toCents } from '../../shared/money.pipe';
import { Sheet } from '../../shared/sheet';

type Tab = 'items' | 'packages' | 'areas';

const TABS: Tab[] = ['items', 'packages', 'areas'];
const ENDPOINTS: Record<Tab, { list: string; one: (id: string) => string }> = {
  items: { list: API.catalog.items, one: API.catalog.item },
  packages: { list: API.catalog.packages, one: API.catalog.package },
  areas: { list: API.catalog.areas, one: API.catalog.area },
};
interface Draft {
  id?: string;
  slug: string;
  label: string;
  areaSlug: string;
  name: string;
  description: string;
  imageUrl: string;
  price: number;
  order: number;
  itemIds: string[];
  soldSeparately: boolean;
}
const blank = (areaSlug = ''): Draft => ({
  slug: '',
  label: '',
  areaSlug,
  name: '',
  description: '',
  imageUrl: '',
  price: 0,
  order: 0,
  itemIds: [],
  soldSeparately: true,
});

@Component({
  selector: 'hc-console-catalog',
  imports: [FormsModule, MoneyPipe, Sheet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.page.html',
  styleUrl: './catalog.page.scss',
})
export class CatalogPage {
  protected readonly currencyCode = inject(TenantForCurrency).company()?.currency ?? 'CAD';
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly tabs = TABS;
  protected readonly tabLabel: Record<Tab, string> = {
    items: $localize`:@@console.catalog.tabs.items:Options`,
    packages: $localize`:@@console.catalog.tabs.packages:Packages`,
    areas: $localize`:@@console.catalog.tabs.areas:Areas`,
  };
  protected readonly addLabel: Record<Tab, string> = {
    items: $localize`:@@console.catalog.add.items:Add option`,
    packages: $localize`:@@console.catalog.add.packages:Add package`,
    areas: $localize`:@@console.catalog.add.areas:Add area`,
  };
  protected readonly newTitle: Record<Tab, string> = {
    items: $localize`:@@console.catalog.sheet.new.items:New option`,
    packages: $localize`:@@console.catalog.sheet.new.packages:New package`,
    areas: $localize`:@@console.catalog.sheet.new.areas:New area`,
  };
  protected readonly editTitle: Record<Tab, string> = {
    items: $localize`:@@console.catalog.sheet.edit.items:Edit option`,
    packages: $localize`:@@console.catalog.sheet.edit.packages:Edit package`,
    areas: $localize`:@@console.catalog.sheet.edit.areas:Edit area`,
  };
  protected readonly catalog = resource({ loader: () => this.api.get<Catalog>(API.catalog.all) });
  protected readonly tab = signal<Tab>('items');
  protected readonly area = signal<string | null>(null);
  protected readonly editing = signal<Tab | null>(null);
  protected readonly busy = signal(false);
  protected draft: Draft = blank();

  protected readonly areas = computed(
    () => (this.catalog.hasValue() ? this.catalog.value() : undefined)?.areas ?? [],
  );
  protected readonly items = computed(() =>
    ((this.catalog.hasValue() ? this.catalog.value() : undefined)?.items ?? []).filter(
      (i) => !this.area() || i.areaSlug === this.area(),
    ),
  );
  protected readonly packages = computed(() =>
    ((this.catalog.hasValue() ? this.catalog.value() : undefined)?.packages ?? []).filter(
      (p) => !this.area() || p.areaSlug === this.area(),
    ),
  );

  protected areaLabel(slug: string): string {
    return this.areas().find((a) => a.slug === slug)?.label ?? slug;
  }
  protected itemName(id: string): string {
    return (
      (this.catalog.hasValue() ? this.catalog.value() : undefined)?.items.find((i) => i.id === id)
        ?.name ?? '—'
    );
  }
  protected itemsInArea(slug: string): CatalogItem[] {
    return ((this.catalog.hasValue() ? this.catalog.value() : undefined)?.items ?? []).filter(
      (i) => i.areaSlug === slug,
    );
  }

  protected add(kind: Tab): void {
    this.draft = blank(this.area() ?? this.areas()[0]?.slug ?? '');
    if (kind === 'areas') this.draft.order = this.areas().length;
    this.editing.set(kind);
  }

  protected editArea(a: Area): void {
    this.draft = {
      ...blank(),
      id: a.slug,
      slug: a.slug,
      label: a.label,
      description: a.description ?? '',
      order: a.order,
    };
    this.editing.set('areas');
  }
  protected editItem(i: CatalogItem): void {
    this.draft = {
      ...blank(i.areaSlug),
      id: i.id,
      name: i.name,
      description: i.description ?? '',
      imageUrl: i.imageUrl ?? '',
      price: i.priceCents / 100,
      soldSeparately: i.soldSeparately !== false,
    };
    this.editing.set('items');
  }
  protected editPackage(p: Package): void {
    this.draft = {
      ...blank(p.areaSlug),
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      imageUrl: p.imageUrl ?? '',
      price: p.priceCents / 100,
      itemIds: [...p.itemIds],
    };
    this.editing.set('packages');
  }

  protected togglePackageItem(id: string): void {
    const ids = this.draft.itemIds;
    this.draft.itemIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  protected async save(): Promise<void> {
    const d = this.draft;
    const kind = this.editing();
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    this.busy.set(true);
    try {
      if (kind === 'areas') {
        const body = {
          label: d.label,
          order: Number(d.order),
          ...(opt(d.description) && { description: opt(d.description) }),
        };
        if (d.id) await this.api.put(API.catalog.area(d.id), body);
        else await this.api.post(API.catalog.areas, { ...body, slug: d.slug });
      } else {
        const body = {
          areaSlug: d.areaSlug,
          name: d.name,
          priceCents: toCents(d.price),
          ...(opt(d.description) && { description: opt(d.description) }),
          ...(opt(d.imageUrl) && { imageUrl: opt(d.imageUrl) }),
          ...(kind === 'packages' && { itemIds: d.itemIds }),
          ...(kind === 'items' && { soldSeparately: d.soldSeparately }),
        };
        const endpoint = ENDPOINTS[kind!];
        if (d.id) await this.api.patch(endpoint.one(d.id), body);
        else await this.api.post(endpoint.list, body);
      }
      this.toast.success($localize`:@@common.saved:Saved`);
      this.editing.set(null);
      this.catalog.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const d = this.draft;
    const kind = this.editing();
    if (!d.id || !kind || this.busy()) return;
    const ok = await this.confirm.ask({
      title: $localize`:@@console.catalog.confirmDelete.title:Delete ${d.name || d.label}:name:?`,
      message: $localize`:@@console.catalog.confirmDelete.message:Homes and packages that use it must be updated first. This cannot be undone.`,
      confirmLabel: $localize`:@@common.actions.delete:Delete`,
      destructive: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.api.delete(ENDPOINTS[kind].one(d.id));
      this.toast.success($localize`:@@common.deleted:Deleted`);
      this.editing.set(null);
      this.catalog.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }
}
