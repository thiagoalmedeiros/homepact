import { HouseStatus } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Catalog, House, HouseInput, PriceOverride } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiRequestError, ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { TenantService as TenantForCurrency } from '../../core/tenant.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { MoneyPipe, toCents } from '../../shared/money.pipe';

const lines = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Price overrides from the editor; empty or equal to the catalog price means none. */
export const toOverrides = (
  prices: Record<string, number | string | null | undefined>,
  catalogPrice: (refId: string) => number | undefined,
): PriceOverride[] =>
  Object.entries(prices).flatMap(([refId, value]) => {
    if (value === null || value === undefined || `${value}`.trim() === '') return [];
    const priceCents = toCents(value);
    return priceCents === catalogPrice(refId) ? [] : [{ refId, priceCents }];
  });

@Component({
  selector: 'hc-house-editor',
  imports: [FormsModule, RouterLink, MoneyPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './house-editor.page.html',
  styleUrl: './house-editor.page.scss',
})
export class HouseEditorPage implements OnInit {
  protected readonly HouseStatus = HouseStatus;
  protected catalogPriceLabel(price: string): string {
    return $localize`:@@console.houseEditor.catalogPrice:Catalog ${price}:price:`;
  }
  protected priceOnPlanLabel(name: string): string {
    return $localize`:@@console.houseEditor.priceOnPlan:${name}:name: price on this plan`;
  }

  protected readonly currencyCode = inject(TenantForCurrency).company()?.currency ?? 'CAD';
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly paths = PATHS;
  readonly id = input<string>();

  protected readonly ready = signal(false);
  protected readonly saving = signal(false);
  protected readonly house = signal<House | null>(null);
  protected readonly catalog = signal<Catalog>({ areas: [], items: [], packages: [] });
  protected readonly errors = signal<Record<string, string[]>>({});
  protected form = {
    name: '',
    slug: '',
    style: '',
    headline: '',
    description: '',
    communities: '',
    images: '',
    floorPlans: '',
    sqft: 0,
    beds: 3,
    baths: 2.5,
    garage: 2,
    storeys: 2,
    basePrice: 0,
  };
  protected prices: Record<string, number | null> = {};

  protected readonly loadError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      await this.load();
    } catch (err) {
      this.loadError.set(
        err instanceof Error
          ? err.message
          : $localize`:@@console.houseEditor.loadFailed:Could not load this home`,
      );
    }
  }

  private async load(): Promise<void> {
    const [catalog, house] = await Promise.all([
      this.api.get<Catalog>(API.catalog.all),
      this.id() ? this.api.get<House>(API.houses.one(this.id()!)) : Promise.resolve(null),
    ]);
    this.catalog.set(catalog);
    this.house.set(house);
    if (house) {
      this.form = {
        name: house.name,
        slug: house.slug,
        style: house.style,
        headline: house.headline ?? '',
        description: house.description,
        communities: house.communities.join(', '),
        images: house.images.join('\n'),
        floorPlans: house.floorPlanImages.join('\n'),
        sqft: house.specs.sqft,
        beds: house.specs.beds,
        baths: house.specs.baths,
        garage: house.specs.garage,
        storeys: house.specs.storeys ?? 2,
        basePrice: house.basePriceCents / 100,
      };
    }
    for (const o of house?.priceOverrides ?? []) this.prices[o.refId] = o.priceCents / 100;
    this.ready.set(true);
  }

  protected autoSlug(): void {
    if (!this.house()) this.form.slug = slugify(this.form.name);
  }

  protected packagesOf(area: string) {
    return this.catalog().packages.filter((p) => p.areaSlug === area);
  }
  protected itemsOf(area: string) {
    return this.catalog().items.filter((i) => i.areaSlug === area);
  }
  protected overrideCount(): number {
    return Object.values(this.prices).filter((v) => v !== null && `${v}`.trim() !== '').length;
  }
  protected firstImage(): string | undefined {
    return lines(this.form.images)[0];
  }

  protected async save(): Promise<void> {
    const f = this.form;
    const body: HouseInput = {
      name: f.name,
      slug: f.slug,
      style: f.style,
      description: f.description,
      communities: lines(f.communities),
      images: lines(f.images),
      floorPlanImages: lines(f.floorPlans),
      specs: {
        sqft: Number(f.sqft),
        beds: Number(f.beds),
        baths: Number(f.baths),
        garage: Number(f.garage),
        storeys: Number(f.storeys),
      },
      basePriceCents: toCents(f.basePrice),
      priceOverrides: toOverrides(this.prices, (id) => {
        const c = this.catalog();
        return (c.packages.find((p) => p.id === id) ?? c.items.find((i) => i.id === id))
          ?.priceCents;
      }),
      ...(f.headline.trim() && { headline: f.headline.trim() }),
    };
    this.saving.set(true);
    this.errors.set({});
    try {
      const existing = this.house();
      const saved = existing
        ? await this.api.patch<House>(API.houses.one(existing.id), body)
        : await this.api.post<House>(API.houses.list, body);
      this.house.set(saved);
      this.toast.success($localize`:@@common.saved:Saved`);
      if (!existing) void this.router.navigate(PATHS.console.home(saved.id), { replaceUrl: true });
    } catch (err) {
      this.toast.error(err);
      if (err instanceof ApiRequestError && err.details) this.errors.set(err.details);
    } finally {
      this.saving.set(false);
    }
  }

  protected async setPublished(publish: boolean): Promise<void> {
    const h = this.house();
    if (!h || this.saving()) return;
    this.saving.set(true);
    try {
      this.house.set(
        await this.api.post<House>(publish ? API.houses.publish(h.id) : API.houses.unpublish(h.id)),
      );
      this.toast.success(
        publish
          ? $localize`:@@console.houseEditor.toasts.published:Published`
          : $localize`:@@console.houseEditor.toasts.drafted:Moved to drafts`,
      );
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const h = this.house();
    if (!h || this.saving()) return;
    const ok = await this.confirm.ask({
      title: $localize`:@@console.houseEditor.confirmDelete.title:Delete ${h.name}:name:?`,
      message: $localize`:@@console.houseEditor.confirmDelete.message:This draft and its option pricing will be removed. This cannot be undone.`,
      confirmLabel: $localize`:@@console.houseEditor.confirmDelete.confirm:Delete draft`,
      destructive: true,
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      await this.api.delete(API.houses.one(h.id));
      this.toast.success($localize`:@@console.houseEditor.toasts.draftDeleted:Draft deleted`);
      void this.router.navigateByUrl(PATHS.console.homes);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  protected err(field: string): string | null {
    return this.errors()[field]?.[0] ?? null;
  }
}
