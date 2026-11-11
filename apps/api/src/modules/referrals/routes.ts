import { patchSchema, referralProgramInputSchema, Role, STAFF_ROLES } from '@homepact/shared';
import { Router, type Request } from 'express';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import { notFound, parse } from '../../http/errors.js';
import { toReferralProgram, type ReferralProgramDoc } from './store.js';

/** Referral programs: staff read them, administrators write them. Proposals keep a copy, so editing
 * or deleting a program never changes them. */
export const referralProgramRoutes = ({ guards, now }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...STAFF_ROLES));
  const adminOnly = guards.requireRole(Role.CompanyAdmin);
  const programs = (req: Request) => req.repo.of<ReferralProgramDoc>('referralPrograms');
  const id = (req: Request) => req.params['id'] as string;

  router.get('/', async (req, res) => {
    const docs = await programs(req).find({}, { sort: { name: 1 } });
    res.json(docs.map(toReferralProgram));
  });

  router.post('/', adminOnly, async (req, res) => {
    const input = parse(referralProgramInputSchema, req.body);
    const ts = now().toISOString();
    const doc = await programs(req).insertOne({
      _id: newId(),
      ...input,
      createdAt: ts,
      updatedAt: ts,
    });
    res.status(201).json(toReferralProgram(doc));
  });

  router.patch('/:id', adminOnly, async (req, res) => {
    const input = parse(patchSchema(referralProgramInputSchema), req.body);
    const doc = await programs(req).findOneAndUpdate(
      { _id: id(req) },
      { $set: { ...input, updatedAt: now().toISOString() } },
    );
    if (!doc) throw notFound();
    res.json(toReferralProgram(doc));
  });

  router.delete('/:id', adminOnly, async (req, res) => {
    const r = await programs(req).deleteOne({ _id: id(req) });
    if (r.deletedCount === 0) throw notFound();
    res.status(204).end();
  });

  return router;
};
