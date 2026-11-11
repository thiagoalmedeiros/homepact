import {
  houseInputSchema,
  HouseStatus,
  houseUpdateSchema,
  quoteRequestSchema,
  STAFF_ROLES,
} from '@homepact/shared';
import { Router, type Request } from 'express';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import { conflict, isDuplicateKey, notFound, parse } from '../../http/errors.js';
import { loadCatalog } from '../catalog/store.js';
import type { InventoryHomeDoc } from '../inventory/store.js';
import type { ProposalDoc } from '../proposals/store.js';
import { companyCurrency, loadHouse, price, pricingContext, pricingExtras } from './pricing.js';
import { assertOverridesInCatalog, toDetail, toHouse, type HouseDoc } from './store.js';
import { ERRORS } from '../../messages.js';

/** Staff management of floor plans, and their live quote with sales tax and referral. */
export const adminHouseRoutes = (ctx: ModuleContext): Router => {
  const { guards, now } = ctx;
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...STAFF_ROLES));
  const houses = (req: Request) => req.repo.of<HouseDoc>('houses');

  router.get('/', async (req, res) => {
    const docs = await houses(req).find({}, { sort: { name: 1 } });
    res.json(docs.map(toHouse));
  });

  router.post('/', async (req, res) => {
    const input = parse(houseInputSchema, req.body);
    assertOverridesInCatalog(input.priceOverrides, await loadCatalog(req.repo));
    const ts = now().toISOString();
    try {
      const doc = await houses(req).insertOne({
        _id: newId(),
        ...input,
        status: HouseStatus.Draft,
        createdAt: ts,
        updatedAt: ts,
      });
      res.status(201).json(toHouse(doc));
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.houses.slugTaken);
      throw err;
    }
  });

  router.get('/:id', async (req, res) => {
    const doc = await houses(req).findOne({ _id: req.params['id'] as string });
    if (!doc) throw notFound();
    res.json(toHouse(doc));
  });

  router.get('/:id/detail', async (req, res) => {
    const doc = await houses(req).findOne({ _id: req.params['id'] as string });
    if (!doc) throw notFound();
    res.json(toDetail(doc, await loadCatalog(req.repo), await companyCurrency(ctx, req)));
  });

  router.patch('/:id', async (req, res) => {
    const input = parse(houseUpdateSchema, req.body);
    if (input.priceOverrides) {
      assertOverridesInCatalog(input.priceOverrides, await loadCatalog(req.repo));
    }
    try {
      const doc = await houses(req).findOneAndUpdate(
        { _id: req.params['id'] as string },
        { $set: { ...input, updatedAt: now().toISOString() } },
      );
      if (!doc) throw notFound();
      res.json(toHouse(doc));
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.houses.slugTaken);
      throw err;
    }
  });

  for (const [action, status] of [
    ['publish', HouseStatus.Published],
    ['unpublish', HouseStatus.Draft],
  ] as const) {
    router.post(`/:id/${action}`, async (req, res) => {
      const doc = await houses(req).findOneAndUpdate(
        { _id: req.params['id'] as string },
        { $set: { status, updatedAt: now().toISOString() } },
      );
      if (!doc) throw notFound();
      res.json(toHouse(doc));
    });
  }

  router.post('/:id/quote', async (req, res) => {
    const input = parse(quoteRequestSchema, req.body);
    const house = await loadHouse(req, req.params['id'] as string);
    const [pc, extras] = await Promise.all([pricingContext(ctx, req), pricingExtras(req, input)]);
    res.json(price(house, pc, input.selections, input.adjustments, extras));
  });

  router.delete('/:id', async (req, res) => {
    const id = req.params['id'] as string;
    const inUse = await Promise.all([
      req.repo.of<ProposalDoc>('proposals').countDocuments({ houseId: id }),
      req.repo.of<InventoryHomeDoc>('inventoryHomes').countDocuments({ houseId: id }),
    ]);
    if (inUse.some((n) => n > 0)) throw conflict(ERRORS.houses.inUse);
    const r = await houses(req).deleteOne({ _id: id, status: HouseStatus.Draft });
    if (r.deletedCount === 0) throw conflict(ERRORS.houses.onlyDraftsDeletable);
    res.status(204).end();
  });

  return router;
};
