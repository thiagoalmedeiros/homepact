import {
  GuestRole,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  Role,
} from '@homepact/shared';
import { Router, type Request } from 'express';
import { hashPassword, verifyPassword } from '../../auth/passwords.js';
import { newId, sha256 } from '../../data/ids.js';
import {
  conflict,
  forbidden,
  isDuplicateKey,
  notFound,
  parse,
  unauthorized,
} from '../../http/errors.js';
import type { ModuleContext } from '../../context.js';
import { issueSession, type RefreshTokenDoc } from './sessions.js';
import { toAuthUser, type UserDoc } from './users.js';
import { ERRORS } from '../../messages.js';

const UNKNOWN_USER_HASH =
  'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Registration, login and sessions. An unknown email is checked against a dummy hash, so timing
 * never reveals an account. Refresh tokens are single-use: reusing one revokes its whole family. */
export const authRoutes = ({ tokens, guards, now }: ModuleContext): Router => {
  const router = Router();
  const refreshTokens = (req: Request) => req.repo.of<RefreshTokenDoc>('refreshTokens');
  const revokeFamily = (req: Request, familyId: string) =>
    refreshTokens(req).updateMany({ familyId }, { $set: { revoked: true } });
  const useOnce = (req: Request, record: RefreshTokenDoc) =>
    refreshTokens(req).updateOne(
      { _id: record._id, usedAt: { $exists: false } },
      { $set: { usedAt: now() } },
    );
  const familyRevokedMeanwhile = async (req: Request, familyId: string) =>
    (await refreshTokens(req).countDocuments({ familyId, revoked: true })) > 0;

  router.post('/register', async (req, res) => {
    if (req.tenant.kind !== 'company') throw forbidden(ERRORS.auth.registrationCompanyOnly);
    const input = parse(registerRequestSchema, req.body);
    const user: Omit<UserDoc, 'companyId'> = {
      _id: newId(),
      email: input.email,
      name: input.name,
      role: Role.Buyer,
      passwordHash: await hashPassword(input.password),
      active: true,
      createdAt: now().toISOString(),
      ...(input.phone && { phone: input.phone }),
    };
    try {
      const saved = await req.repo.of<UserDoc>('users').insertOne(user);
      res.status(201).json(await issueSession(req.repo, tokens, saved, now()));
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(ERRORS.auth.emailTaken);
      throw err;
    }
  });

  router.post('/login', async (req, res) => {
    const input = parse(loginRequestSchema, req.body);
    const user = await req.repo.of<UserDoc>('users').findOne({ email: input.email });
    const ok = await verifyPassword(input.password, user?.passwordHash ?? UNKNOWN_USER_HASH);
    if (!user || !ok || !user.active) throw unauthorized(ERRORS.auth.badCredentials);
    if ((user.role === Role.SuperAdmin) !== (req.tenant.kind === 'platform')) {
      throw unauthorized(ERRORS.auth.badCredentials);
    }
    res.json(await issueSession(req.repo, tokens, user, now()));
  });

  router.post('/refresh', async (req, res) => {
    const { refreshToken } = parse(refreshRequestSchema, req.body);
    const record = await refreshTokens(req).findOne({ hash: sha256(refreshToken) });
    if (!record || record.revoked || record.expiresAt.getTime() < now().getTime()) {
      throw unauthorized(ERRORS.auth.invalidRefreshToken);
    }
    const firstUse = (await useOnce(req, record)).modifiedCount === 1;
    if (!firstUse) {
      await revokeFamily(req, record.familyId);
      throw unauthorized(ERRORS.auth.refreshTokenReuse);
    }
    const user = await req.repo.of<UserDoc>('users').findOne({ _id: record.userId, active: true });
    if (!user) throw unauthorized(ERRORS.auth.invalidRefreshToken);
    const session = await issueSession(req.repo, tokens, user, now(), record.familyId);
    if (await familyRevokedMeanwhile(req, record.familyId)) {
      await revokeFamily(req, record.familyId);
      throw unauthorized(ERRORS.auth.refreshTokenReuse);
    }
    res.json(session);
  });

  router.post('/logout', async (req, res) => {
    const { refreshToken } = parse(refreshRequestSchema, req.body);
    const record = await refreshTokens(req).findOne({ hash: sha256(refreshToken) });
    if (record) await revokeFamily(req, record.familyId);
    res.status(204).end();
  });

  router.get('/me', guards.requireAuth, async (req, res) => {
    if (req.principal?.role === GuestRole.KeyHolder) throw notFound();
    const user = await req.repo.of<UserDoc>('users').findOne({ _id: req.principal!.sub });
    if (!user) throw notFound();
    res.json(toAuthUser(user));
  });

  return router;
};
