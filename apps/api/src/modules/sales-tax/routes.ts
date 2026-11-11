import {
  Role,
  STAFF_ROLES,
  taxRateAdoptSchema,
  taxRateInputSchema,
  type TaxComponent,
} from '@homepact/shared';
import { Router, type Request } from 'express';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import { findTaxPreset } from '../../data/platform-repo.js';
import { conflict, isDuplicateKey, notFound, parse } from '../../http/errors.js';
import { toTaxRate, type TaxRateDoc } from './store.js';
import { ERRORS } from '../../messages.js';

/** Provinces a company sells in and their sales tax: staff read them, administrators adopt a
 * suggestion or enter their own. One is the default: the first added, and another is promoted when
 * it is removed. */
export const taxRateRoutes = ({ db, guards, now }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...STAFF_ROLES));
  const adminOnly = guards.requireRole(Role.CompanyAdmin);
  const rates = (req: Request) => req.repo.of<TaxRateDoc>('taxRates');
  const id = (req: Request) => req.params['id'] as string;

  const demoteOthers = (req: Request, keepId: string) =>
    rates(req).updateMany(
      { _id: { $ne: keepId }, isDefault: true },
      { $set: { isDefault: false } },
    );

  const insert = async (
    req: Request,
    rate: { code: string; name: string; components: TaxComponent[]; presetId?: string },
    askedDefault: boolean,
  ) => {
    const isFirst = (await rates(req).countDocuments({})) === 0;
    const isDefault = askedDefault || isFirst;
    const ts = now().toISOString();
    let doc: TaxRateDoc;
    try {
      doc = await rates(req).insertOne({
        _id: newId(),
        ...rate,
        isDefault,
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.taxes.regionTaken(rate.code));
      throw err;
    }
    if (isDefault) await demoteOthers(req, doc._id);
    return doc;
  };

  const promoteNextDefault = async (req: Request) => {
    const [next] = await rates(req).find({}, { sort: { name: 1 }, limit: 1 });
    if (next) await rates(req).updateOne({ _id: next._id }, { $set: { isDefault: true } });
  };

  router.get('/', async (req, res) => {
    const docs = await rates(req).find({}, { sort: { name: 1 } });
    res.json(docs.map(toTaxRate));
  });

  router.post('/', adminOnly, async (req, res) => {
    const { isDefault, ...rate } = parse(taxRateInputSchema, req.body);
    res.status(201).json(toTaxRate(await insert(req, rate, isDefault)));
  });

  router.post('/adopt', adminOnly, async (req, res) => {
    const { presetId, isDefault } = parse(taxRateAdoptSchema, req.body);
    const preset = await findTaxPreset(db, presetId);
    if (!preset) throw notFound(ERRORS.taxes.presetNotFound);
    const rate = {
      code: preset.code,
      name: preset.name,
      components: preset.components,
      presetId: preset._id,
    };
    res.status(201).json(toTaxRate(await insert(req, rate, isDefault)));
  });

  router.put('/:id', adminOnly, async (req, res) => {
    const input = parse(taxRateInputSchema, req.body);
    let doc: TaxRateDoc | null;
    try {
      doc = await rates(req).findOneAndUpdate(
        { _id: id(req) },
        { $set: { ...input, updatedAt: now().toISOString() } },
      );
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.taxes.regionTaken(input.code));
      throw err;
    }
    if (!doc) throw notFound();
    if (doc.isDefault) await demoteOthers(req, doc._id);
    res.json(toTaxRate(doc));
  });

  router.delete('/:id', adminOnly, async (req, res) => {
    const doc = await rates(req).findOne({ _id: id(req) });
    if (!doc) throw notFound();
    const r = await rates(req).deleteOne({ _id: doc._id });
    if (r.deletedCount === 0) throw notFound();
    if (doc.isDefault) await promoteNextDefault(req);
    res.status(204).end();
  });

  return router;
};
