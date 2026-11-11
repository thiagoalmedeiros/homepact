import {
  companyAdminCreateSchema,
  companyInputSchema,
  companyUpdateSchema,
  normalizeOrigin,
  Role,
  type Company,
} from '@homepact/shared';
import { Router } from 'express';
import { hashPassword } from '../../auth/passwords.js';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import { companiesCollection, type CompanyDoc } from '../../data/platform-repo.js';
import { tenantRepo } from '../../data/tenant-repo.js';
import { conflict, isDuplicateKey, notFound, parse } from '../../http/errors.js';
import { toAuthUser, type UserDoc } from '../auth/users.js';
import { ERRORS } from '../../messages.js';

export const toCompany = ({ _id, ...rest }: CompanyDoc): Company => ({ id: _id, ...rest });

/** Super-admin company registry (platform origin only), including each company's first
 * administrator. */
export const companyRoutes = ({ db, guards, resolver, now }: ModuleContext): Router => {
  const router = Router();
  const companies = companiesCollection(db);
  router.use(guards.requireAuth, guards.requireRole(Role.SuperAdmin));

  const uniqueOrigins = (origins: string[]) => [...new Set(origins.map(normalizeOrigin))];

  router.get('/', async (_req, res) => {
    const docs = await companies.find({}, { sort: { name: 1 } }).toArray();
    res.json(docs.map(toCompany));
  });

  router.post('/', async (req, res) => {
    const input = parse(companyInputSchema, req.body);
    const ts = now().toISOString();
    const doc: CompanyDoc = {
      _id: newId(),
      ...input,
      origins: uniqueOrigins(input.origins),
      createdAt: ts,
      updatedAt: ts,
    };
    try {
      await companies.insertOne(doc);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.companies.originOrSlugTaken);
      throw err;
    } finally {
      resolver.invalidate();
    }
    res.status(201).json(toCompany(doc));
  });

  router.get('/:id', async (req, res) => {
    const doc = await companies.findOne({ _id: req.params['id'] as string });
    if (!doc) throw notFound();
    res.json(toCompany(doc));
  });

  router.patch('/:id', async (req, res) => {
    const input = parse(companyUpdateSchema, req.body);
    const set: Partial<CompanyDoc> = { ...input, updatedAt: now().toISOString() };
    if (input.origins) set.origins = uniqueOrigins(input.origins);
    let doc: CompanyDoc | null;
    try {
      doc = await companies.findOneAndUpdate(
        { _id: req.params['id'] as string },
        { $set: set },
        { returnDocument: 'after' },
      );
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.companies.originOrSlugTaken);
      throw err;
    } finally {
      resolver.invalidate();
    }
    if (!doc) throw notFound();
    res.json(toCompany(doc));
  });

  router.post('/:id/admins', async (req, res) => {
    const company = await companies.findOne({ _id: req.params['id'] as string });
    if (!company) throw notFound();
    const input = parse(companyAdminCreateSchema, req.body);
    const user: Omit<UserDoc, 'companyId'> = {
      _id: newId(),
      email: input.email,
      name: input.name,
      role: Role.CompanyAdmin,
      passwordHash: await hashPassword(input.password),
      active: true,
      createdAt: now().toISOString(),
      ...(input.phone && { phone: input.phone }),
    };
    try {
      const saved = await tenantRepo(db, company._id).of<UserDoc>('users').insertOne(user);
      res.status(201).json(toAuthUser(saved));
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.auth.emailTaken);
      throw err;
    }
  });

  return router;
};
