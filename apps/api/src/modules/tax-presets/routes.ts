import {
  CANADIAN_TAX_PRESETS,
  Role,
  STAFF_ROLES,
  taxPresetInputSchema,
  type TaxPreset,
} from '@homepact/shared';
import { Router } from 'express';
import type { Db, UpdateFilter } from 'mongodb';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import {
  listTaxPresets,
  taxPresetsCollection,
  type TaxPresetDoc,
} from '../../data/platform-repo.js';
import { notFound, parse } from '../../http/errors.js';

export const toTaxPreset = ({ _id, ...rest }: TaxPresetDoc): TaxPreset => ({ id: _id, ...rest });

/** Adds the missing Canadian suggestions (new-home GST/HST/QST as of 2025; not tax advice, rebates
 * excluded) by province code, never overwriting edited ones. Returns how many it added. */
export const addStarterPresets = async (db: Db, at: Date): Promise<number> => {
  const presets = taxPresetsCollection(db);
  const have = new Set((await listTaxPresets(db)).map((p) => p.code));
  const missing = CANADIAN_TAX_PRESETS.filter((p) => !have.has(p.code));
  const ts = at.toISOString();
  for (const preset of missing) {
    await presets.insertOne({
      _id: newId(),
      ...taxPresetInputSchema.parse(preset),
      createdAt: ts,
      updatedAt: ts,
    });
  }
  return missing.length;
};

/** The platform's sales tax suggestions (super-admin only); companies adopt copies. `POST /starter`
 * adds the missing Canadian provinces. */
export const platformTaxPresetRoutes = ({ db, guards, now }: ModuleContext): Router => {
  const router = Router();
  const presets = taxPresetsCollection(db);
  router.use(guards.requireAuth, guards.requireRole(Role.SuperAdmin));

  router.get('/', async (_req, res) => {
    res.json((await listTaxPresets(db)).map(toTaxPreset));
  });

  router.post('/', async (req, res) => {
    const input = parse(taxPresetInputSchema, req.body);
    const ts = now().toISOString();
    const doc: TaxPresetDoc = { _id: newId(), ...input, createdAt: ts, updatedAt: ts };
    await presets.insertOne(doc);
    res.status(201).json(toTaxPreset(doc));
  });

  router.post('/starter', async (_req, res) => {
    const added = await addStarterPresets(db, now());
    res.status(added ? 201 : 200).json((await listTaxPresets(db)).map(toTaxPreset));
  });

  router.put('/:id', async (req, res) => {
    const { note, ...input } = parse(taxPresetInputSchema, req.body);
    const set = { ...input, updatedAt: now().toISOString() };
    const replacement: UpdateFilter<TaxPresetDoc> = note
      ? { $set: { ...set, note } }
      : { $set: set, $unset: { note: '' } };
    const doc = await presets.findOneAndUpdate({ _id: req.params['id'] as string }, replacement, {
      returnDocument: 'after',
    });
    if (!doc) throw notFound();
    res.json(toTaxPreset(doc));
  });

  router.delete('/:id', async (req, res) => {
    const r = await presets.deleteOne({ _id: req.params['id'] as string });
    if (r.deletedCount === 0) throw notFound();
    res.status(204).end();
  });

  return router;
};

/** What a company's staff see of the platform's suggestions: read-only, to adopt them. */
export const taxPresetRoutes = ({ db, guards }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...STAFF_ROLES));
  router.get('/', async (_req, res) => {
    res.json((await listTaxPresets(db)).map(toTaxPreset));
  });
  return router;
};
