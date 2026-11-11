import {
  isSoldSeparately,
  type Catalog,
  type ConfiguratorArea,
  type Currency,
  type House,
  type HouseDetail,
  type HouseSummary,
  type Package,
  type PriceOverride,
} from '@homepact/shared';
import type { TenantDoc } from '../../data/tenant-repo.js';
import { unprocessable } from '../../http/errors.js';
import { ERRORS } from '../../messages.js';

export interface HouseDoc extends TenantDoc, Omit<House, 'id'> {}

export const toHouse = ({ _id, companyId: _c, ...rest }: HouseDoc): House => ({
  id: _id,
  ...rest,
  priceOverrides: rest.priceOverrides ?? [],
});

export const toSummary = (h: HouseDoc, currency: Currency): HouseSummary => ({
  id: h._id,
  name: h.name,
  slug: h.slug,
  style: h.style,
  communities: h.communities,
  specs: h.specs,
  basePriceCents: h.basePriceCents,
  currency,
  ...(h.headline && { headline: h.headline }),
  ...(h.images[0] && { imageUrl: h.images[0] }),
});

/** Price overrides may only name packages or items of this company's catalog. */
export const assertOverridesInCatalog = (overrides: PriceOverride[], catalog: Catalog): void => {
  for (const { refId } of overrides) {
    const known =
      catalog.packages.some((p) => p.id === refId) || catalog.items.some((i) => i.id === refId);
    if (!known) throw unprocessable(ERRORS.houses.optionNotInCatalog(refId));
  }
};

/** What either side can choose on this plan: the catalog, priced with the plan's overrides. */
export const toDetail = (h: HouseDoc, catalog: Catalog, currency: Currency): HouseDetail => {
  const { priceOverrides, ...house } = toHouse(h);
  const override = new Map((priceOverrides ?? []).map((o) => [o.refId, o.priceCents]));
  const priced = (id: string, catalogPrice: number) => {
    const own = override.get(id);
    return own === undefined || own === catalogPrice
      ? { priceCents: catalogPrice }
      : { priceCents: own, catalogPriceCents: catalogPrice };
  };
  const areas: ConfiguratorArea[] = [];
  for (const area of catalog.areas) {
    const planPrice = (p: Package) => override.get(p.id) ?? p.priceCents;
    const packagesCheapestFirst = catalog.packages
      .filter((p) => p.areaSlug === area.slug)
      .sort((a, b) => planPrice(a) - planPrice(b));
    const items = catalog.items.filter((i) => i.areaSlug === area.slug);
    if (!packagesCheapestFirst.length && !items.length) continue;
    areas.push({
      slug: area.slug,
      label: area.label,
      ...(area.description && { description: area.description }),
      packages: packagesCheapestFirst.map((p) => ({
        id: p.id,
        name: p.name,
        ...priced(p.id, p.priceCents),
        itemIds: p.itemIds,
        itemNames: p.itemIds.flatMap((id) => catalog.items.find((i) => i.id === id)?.name ?? []),
        ...(p.description && { description: p.description }),
        ...(p.imageUrl && { imageUrl: p.imageUrl }),
      })),
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        ...priced(i.id, i.priceCents),
        soldSeparately: isSoldSeparately(i),
        ...(i.description && { description: i.description }),
        ...(i.imageUrl && { imageUrl: i.imageUrl }),
      })),
    });
  }
  return { house, currency, areas };
};
