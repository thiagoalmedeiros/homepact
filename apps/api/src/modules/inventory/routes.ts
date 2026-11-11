import { inventoryHomeInputSchema, inventoryHomeUpdateSchema, STAFF_ROLES } from '@homepact/shared';
import { Router, type Request } from 'express';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import { conflict, notFound, parse } from '../../http/errors.js';
import type { HouseDoc } from '../houses/store.js';
import { loadHouse, pricingContext } from '../houses/pricing.js';
import type { ProposalDoc } from '../proposals/store.js';
import { quoteInventory, toInventoryHome, type InventoryHomeDoc } from './store.js';
import { ERRORS } from '../../messages.js';

/** Staff management of pre-existing homes (spec / quick possession). */
export const inventoryRoutes = (ctx: ModuleContext): Router => {
  const { guards, now } = ctx;
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...STAFF_ROLES));
  const homes = (req: Request) => req.repo.of<InventoryHomeDoc>('inventoryHomes');

  router.get('/', async (req, res) => {
    const pc = await pricingContext(ctx, req);
    const [docs, houses] = await Promise.all([
      homes(req).find({}, { sort: { status: 1, address: 1 } }),
      req.repo.of<HouseDoc>('houses').find({}),
    ]);
    res.json(
      docs.flatMap((d) => {
        const house = houses.find((h) => h._id === d.houseId);
        return house ? [toInventoryHome(d, house, pc)] : [];
      }),
    );
  });

  router.post('/', async (req, res) => {
    const input = parse(inventoryHomeInputSchema, req.body);
    const house = await loadHouse(req, input.houseId);
    const pc = await pricingContext(ctx, req);
    quoteInventory(input, house, pc); // validates the configuration (422)
    const ts = now().toISOString();
    const doc = await homes(req).insertOne({
      _id: newId(),
      ...input,
      createdAt: ts,
      updatedAt: ts,
    });
    res.status(201).json(toInventoryHome(doc, house, pc));
  });

  router.get('/:id', async (req, res) => {
    const doc = await homes(req).findOne({ _id: req.params['id'] as string });
    if (!doc) throw notFound();
    res.json(
      toInventoryHome(doc, await loadHouse(req, doc.houseId), await pricingContext(ctx, req)),
    );
  });

  router.patch('/:id', async (req, res) => {
    const input = parse(inventoryHomeUpdateSchema, req.body);
    const current = await homes(req).findOne({ _id: req.params['id'] as string });
    if (!current) throw notFound();
    const house = await loadHouse(req, input.houseId ?? current.houseId);
    const pc = await pricingContext(ctx, req);
    quoteInventory({ ...current, ...input }, house, pc);
    const doc = await homes(req).findOneAndUpdate(
      { _id: current._id },
      { $set: { ...input, updatedAt: now().toISOString() } },
    );
    res.json(toInventoryHome(doc!, house, pc));
  });

  router.delete('/:id', async (req, res) => {
    const id = req.params['id'] as string;
    if ((await req.repo.of<ProposalDoc>('proposals').countDocuments({ inventoryHomeId: id })) > 0) {
      throw conflict(ERRORS.inventory.hasProposals);
    }
    const r = await homes(req).deleteOne({ _id: id });
    if (r.deletedCount === 0) throw notFound();
    res.status(204).end();
  });

  return router;
};
