import {
  areaSchema,
  catalogItemInputSchema,
  packageInputSchema,
  patchSchema,
  STAFF_ROLES,
} from '@homepact/shared';
import { Router } from 'express';
import type { UpdateFilter } from 'mongodb';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import type { TenantRepo } from '../../data/tenant-repo.js';
import { conflict, isDuplicateKey, notFound, parse, unprocessable } from '../../http/errors.js';
import type { HouseDoc } from '../houses/store.js';
import type { InventoryHomeDoc } from '../inventory/store.js';
import {
  loadCatalog,
  toArea,
  toItem,
  toPackage,
  type AreaDoc,
  type CatalogItemDoc,
  type PackageDoc,
} from './store.js';
import { ERRORS } from '../../messages.js';

const assertArea = async (repo: TenantRepo, slug: string) => {
  if (!(await repo.of<AreaDoc>('areas').findOne({ slug }))) {
    throw unprocessable(ERRORS.catalog.unknownArea(slug));
  }
};

/** Packages may only bundle items of their own area. */
const assertPackageItems = async (repo: TenantRepo, areaSlug: string, itemIds: string[]) => {
  const unique = [...new Set(itemIds)];
  const found = await repo
    .of<CatalogItemDoc>('catalogItems')
    .countDocuments({ _id: { $in: unique }, areaSlug });
  if (found !== unique.length) throw unprocessable(ERRORS.catalog.packageItemsOutsideArea);
};

/** Pre-existing homes are built with these options; their configuration must stay intact. */
const assertNotInInventory = async (repo: TenantRepo, refId: string) => {
  const homes = await repo.of<InventoryHomeDoc>('inventoryHomes').find({});
  const used = homes.some((h) =>
    Object.values(h.selections ?? {}).some((s) =>
      'packageId' in s ? s.packageId === refId : s.itemIds.includes(refId),
    ),
  );
  if (used) throw conflict(ERRORS.catalog.usedByInventory);
};

/** Floor-plan price overrides for a deleted option are meaningless; drop them. */
const dropOverrides = (repo: TenantRepo, refId: string) =>
  repo
    .of<HouseDoc>('houses')
    .updateMany({}, { $pull: { priceOverrides: { refId } } } as unknown as UpdateFilter<HouseDoc>);

export const catalogRoutes = ({ guards }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...STAFF_ROLES));

  router.get('/', async (req, res) => {
    res.json(await loadCatalog(req.repo));
  });

  router.post('/areas', async (req, res) => {
    const input = parse(areaSchema, req.body);
    try {
      const doc = await req.repo.of<AreaDoc>('areas').insertOne({ _id: newId(), ...input });
      res.status(201).json(toArea(doc));
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.catalog.areaSlugTaken);
      throw err;
    }
  });

  router.put('/areas/:slug', async (req, res) => {
    const input = parse(areaSchema.omit({ slug: true }), req.body);
    const doc = await req.repo
      .of<AreaDoc>('areas')
      .findOneAndUpdate({ slug: req.params['slug'] as string }, { $set: input });
    if (!doc) throw notFound();
    res.json(toArea(doc));
  });

  router.delete('/areas/:slug', async (req, res) => {
    const slug = req.params['slug'] as string;
    const inUse =
      (await req.repo.of<CatalogItemDoc>('catalogItems').countDocuments({ areaSlug: slug })) +
      (await req.repo.of<PackageDoc>('packages').countDocuments({ areaSlug: slug }));
    if (inUse > 0) throw conflict(ERRORS.catalog.areaInUse);
    const r = await req.repo.of<AreaDoc>('areas').deleteOne({ slug });
    if (r.deletedCount === 0) throw notFound();
    res.status(204).end();
  });

  router.post('/items', async (req, res) => {
    const input = parse(catalogItemInputSchema, req.body);
    await assertArea(req.repo, input.areaSlug);
    const doc = await req.repo
      .of<CatalogItemDoc>('catalogItems')
      .insertOne({ _id: newId(), ...input });
    res.status(201).json(toItem(doc));
  });

  router.patch('/items/:id', async (req, res) => {
    const input = parse(patchSchema(catalogItemInputSchema), req.body);
    if (input.areaSlug) await assertArea(req.repo, input.areaSlug);
    const doc = await req.repo
      .of<CatalogItemDoc>('catalogItems')
      .findOneAndUpdate({ _id: req.params['id'] as string }, { $set: input });
    if (!doc) throw notFound();
    res.json(toItem(doc));
  });

  router.delete('/items/:id', async (req, res) => {
    const id = req.params['id'] as string;
    const inPackages = await req.repo.of<PackageDoc>('packages').countDocuments({ itemIds: id });
    if (inPackages > 0) throw conflict(ERRORS.catalog.itemInPackage);
    await assertNotInInventory(req.repo, id);
    const r = await req.repo.of<CatalogItemDoc>('catalogItems').deleteOne({ _id: id });
    if (r.deletedCount === 0) throw notFound();
    await dropOverrides(req.repo, id);
    res.status(204).end();
  });

  router.post('/packages', async (req, res) => {
    const input = parse(packageInputSchema, req.body);
    await assertArea(req.repo, input.areaSlug);
    await assertPackageItems(req.repo, input.areaSlug, input.itemIds);
    const doc = await req.repo
      .of<PackageDoc>('packages')
      .insertOne({ _id: newId(), ...input, itemIds: [...new Set(input.itemIds)] });
    res.status(201).json(toPackage(doc));
  });

  router.patch('/packages/:id', async (req, res) => {
    const input = parse(patchSchema(packageInputSchema), req.body);
    const col = req.repo.of<PackageDoc>('packages');
    const current = await col.findOne({ _id: req.params['id'] as string });
    if (!current) throw notFound();
    const areaSlug = input.areaSlug ?? current.areaSlug;
    if (input.areaSlug) await assertArea(req.repo, areaSlug);
    await assertPackageItems(req.repo, areaSlug, input.itemIds ?? current.itemIds);
    const doc = await col.findOneAndUpdate({ _id: current._id }, { $set: input });
    res.json(toPackage(doc!));
  });

  router.delete('/packages/:id', async (req, res) => {
    const id = req.params['id'] as string;
    await assertNotInInventory(req.repo, id);
    const r = await req.repo.of<PackageDoc>('packages').deleteOne({ _id: id });
    if (r.deletedCount === 0) throw notFound();
    await dropOverrides(req.repo, id);
    res.status(204).end();
  });

  return router;
};
