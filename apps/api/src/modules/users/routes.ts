import { COMPANY_ROLES, Role, userCreateSchema, userUpdateSchema } from '@homepact/shared';
import { Router } from 'express';
import { hashPassword } from '../../auth/passwords.js';
import type { ModuleContext } from '../../context.js';
import { newId } from '../../data/ids.js';
import { badRequest, conflict, isDuplicateKey, notFound, parse } from '../../http/errors.js';
import { toAuthUser, type UserDoc } from '../auth/users.js';
import { ERRORS } from '../../messages.js';

/** Company team management (sales, finance and administrators). Everyone on the team can list
 * colleagues; administrators manage them. */
export const userRoutes = ({ guards, now }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...COMPANY_ROLES));
  const adminOnly = guards.requireRole(Role.CompanyAdmin);

  router.get('/', async (req, res) => {
    const users = await req.repo
      .of<UserDoc>('users')
      .find({ role: { $in: [...COMPANY_ROLES] } }, { sort: { name: 1 } });
    res.json(users.map(toAuthUser));
  });

  router.post('/', adminOnly, async (req, res) => {
    const input = parse(userCreateSchema, req.body);
    try {
      const saved = await req.repo.of<UserDoc>('users').insertOne({
        _id: newId(),
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        active: true,
        createdAt: now().toISOString(),
        ...(input.phone && { phone: input.phone }),
      });
      res.status(201).json(toAuthUser(saved));
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.auth.emailTaken);
      throw err;
    }
  });

  router.patch('/:id', adminOnly, async (req, res) => {
    const input = parse(userUpdateSchema, req.body);
    const id = req.params['id'] as string;
    const demoted = input.role !== undefined && input.role !== Role.CompanyAdmin;
    if (id === req.principal!.sub && (input.active === false || demoted)) {
      throw badRequest(ERRORS.users.cannotDemoteSelf);
    }
    const user = await req.repo
      .of<UserDoc>('users')
      .findOneAndUpdate({ _id: id, role: { $in: [...COMPANY_ROLES] } }, { $set: input });
    if (!user) throw notFound();
    res.json(toAuthUser(user));
  });

  return router;
};
