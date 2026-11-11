import type { Area, Catalog, CatalogItem, Package } from '@homepact/shared';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';

export interface AreaDoc extends TenantDoc, Omit<Area, never> {}
export interface CatalogItemDoc extends TenantDoc, Omit<CatalogItem, 'id'> {}
export interface PackageDoc extends TenantDoc, Omit<Package, 'id'> {}

export const toArea = ({ slug, label, description, order }: AreaDoc): Area => ({
  slug,
  label,
  order,
  ...(description && { description }),
});
export const toItem = ({ _id, companyId: _c, ...rest }: CatalogItemDoc): CatalogItem => ({
  id: _id,
  ...rest,
});
export const toPackage = ({ _id, companyId: _c, ...rest }: PackageDoc): Package => ({
  id: _id,
  ...rest,
});

export const loadCatalog = async (repo: TenantRepo): Promise<Catalog> => {
  const [areas, items, packages] = await Promise.all([
    repo.of<AreaDoc>('areas').find({}, { sort: { order: 1, label: 1 } }),
    repo.of<CatalogItemDoc>('catalogItems').find({}, { sort: { name: 1 } }),
    repo.of<PackageDoc>('packages').find({}, { sort: { name: 1 } }),
  ]);
  return { areas: areas.map(toArea), items: items.map(toItem), packages: packages.map(toPackage) };
};
