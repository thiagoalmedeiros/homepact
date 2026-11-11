import { agreementTemplateInputSchema, Role, STAFF_ROLES } from '@homepact/shared';
import { Router, type Request } from 'express';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import { conflict, isDuplicateKey, notFound, parse } from '../../http/errors.js';
import { normalizeSections, toTemplate, type AgreementTemplateDoc } from './store.js';
import { ERRORS } from '../../messages.js';

/** Agreement templates: staff read them, administrators write them, agreements keep a copy. One is
 * the default: the first created, or the last one made default. */
export const agreementTemplateRoutes = ({ guards, now }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...STAFF_ROLES));
  const adminOnly = guards.requireRole(Role.CompanyAdmin);
  const templates = (req: Request) => req.repo.of<AgreementTemplateDoc>('agreementTemplates');
  const id = (req: Request) => req.params['id'] as string;

  const demoteOthers = (req: Request, keepId: string) =>
    templates(req).updateMany(
      { _id: { $ne: keepId }, isDefault: true },
      { $set: { isDefault: false } },
    );

  router.get('/', async (req, res) => {
    const docs = await templates(req).find({}, { sort: { name: 1 } });
    res.json(docs.map(toTemplate));
  });

  router.get('/:id', async (req, res) => {
    const doc = await templates(req).findOne({ _id: id(req) });
    if (!doc) throw notFound();
    res.json(toTemplate(doc));
  });

  router.post('/', adminOnly, async (req, res) => {
    const input = parse(agreementTemplateInputSchema, req.body);
    const isFirst = (await templates(req).countDocuments({})) === 0;
    const isDefault = input.isDefault || isFirst;
    const ts = now().toISOString();
    let doc: AgreementTemplateDoc;
    try {
      doc = await templates(req).insertOne({
        _id: newId(),
        ...input,
        sections: normalizeSections(input.sections),
        isDefault,
        version: 1,
        updatedByName: req.principal!.name,
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.templates.nameTaken);
      throw err;
    }
    if (isDefault) await demoteOthers(req, doc._id);
    res.status(201).json(toTemplate(doc));
  });

  router.put('/:id', adminOnly, async (req, res) => {
    const input = parse(agreementTemplateInputSchema, req.body);
    let doc: AgreementTemplateDoc | null;
    try {
      doc = await templates(req).findOneAndUpdate(
        { _id: id(req) },
        {
          $set: {
            ...input,
            sections: normalizeSections(input.sections),
            updatedByName: req.principal!.name,
            updatedAt: now().toISOString(),
          },
          $inc: { version: 1 },
        },
      );
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.templates.nameTaken);
      throw err;
    }
    if (!doc) throw notFound();
    if (doc.isDefault) await demoteOthers(req, doc._id);
    res.json(toTemplate(doc));
  });

  router.delete('/:id', adminOnly, async (req, res) => {
    const r = await templates(req).deleteOne({ _id: id(req) });
    if (r.deletedCount === 0) throw notFound();
    res.status(204).end();
  });

  return router;
};
