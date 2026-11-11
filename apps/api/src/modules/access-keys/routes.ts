import {
  accessKeyListQuerySchema,
  accessKeyRequestSchema,
  AccessKeyStatus,
  AccessResourceType,
  GuestRole,
  Role,
  STAFF_ROLES,
  type AccessKeyRotated,
  type AccessSession,
  type ClaimResult,
} from '@homepact/shared';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { KEY_SESSION_TTL_S } from '../../auth/tokens.js';
import type { ModuleContext } from '../../context.js';
import { findAccessKeyByHash } from '../../data/access-key-lookup.js';
import { randomCode, sha256 } from '../../data/ids.js';
import type { TenantRepo } from '../../data/tenant-repo.js';
import { conflict, forbidden, notFound, parse, unprocessable } from '../../http/errors.js';
import type { ProposalDoc } from '../proposals/store.js';
import { createAccessKey, hashCode, toKeyInfo, type AccessKeyDoc } from './keys.js';
import { ERRORS, NAMES } from '../../messages.js';

const setResourceKey = async (repo: TenantRepo, k: AccessKeyDoc, accessKeyId: string) => {
  if (k.resourceType !== AccessResourceType.Proposal) return;
  await repo
    .of<ProposalDoc>('proposals')
    .updateOne({ _id: k.resourceId }, { $set: { accessKeyId } });
};

/** Buyer-side access keys: failed attempts are rate-limited, signing links also need their code,
 * and only proposal links can be claimed by an account. */
export const accessRoutes = ({ db, tokens, guards, now, accessKeyRateLimit }: ModuleContext) => {
  const router = Router();

  const failedAttemptsLimiter = rateLimit({
    windowMs: accessKeyRateLimit.windowMs,
    limit: accessKeyRateLimit.max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${req.tenant.origin}`,
    message: { error: ERRORS.accessKeys.tooManyAttempts },
  });

  router.post('/session', failedAttemptsLimiter, async (req, res) => {
    const { key, code } = parse(accessKeyRequestSchema, req.body);
    const doc = await findAccessKeyByHash(db, sha256(key));
    if (!doc || doc.status !== AccessKeyStatus.Active) throw notFound(ERRORS.accessKeys.invalidKey);
    if (doc.companyId !== req.tenant.companyId) throw forbidden(ERRORS.accessKeys.keyWrongOrigin);
    const isSigningLink = !!doc.codeHash;
    if (isSigningLink) {
      if (!code) throw unprocessable(ERRORS.accessKeys.codeRequired);
      if (hashCode(doc._id, code) !== doc.codeHash) throw notFound(ERRORS.accessKeys.invalidKey);
    }
    await req.repo
      .of<AccessKeyDoc>('accessKeys')
      .updateOne({ _id: doc._id }, { $set: { lastUsedAt: now().toISOString() } });
    const accessToken = await tokens.sign(
      {
        sub: doc._id,
        role: GuestRole.KeyHolder,
        companyId: doc.companyId,
        name: NAMES.guest,
        resource: { type: doc.resourceType, id: doc.resourceId },
        ...(doc.signerId && { signerId: doc.signerId }),
      },
      KEY_SESSION_TTL_S,
    );
    res.json({
      accessToken,
      expiresIn: KEY_SESSION_TTL_S,
      resourceType: doc.resourceType,
      resourceId: doc.resourceId,
      ...(doc.signerId && { signerId: doc.signerId }),
    } satisfies AccessSession);
  });

  router.post('/claim', guards.requireAuth, guards.requireRole(Role.Buyer), async (req, res) => {
    const { key } = parse(accessKeyRequestSchema, req.body);
    const keys = req.repo.of<AccessKeyDoc>('accessKeys');
    const doc = await keys.findOne({ hash: sha256(key) });
    if (!doc || doc.status !== AccessKeyStatus.Active) throw notFound(ERRORS.accessKeys.invalidKey);
    const isProposalLink = doc.resourceType === AccessResourceType.Proposal;
    if (!isProposalLink) throw unprocessable(ERRORS.accessKeys.onlyProposalKeys);
    const claimed = await keys.updateOne(
      { _id: doc._id, status: AccessKeyStatus.Active },
      { $set: { status: AccessKeyStatus.Claimed, lastUsedAt: now().toISOString() } },
    );
    if (claimed.modifiedCount === 0) throw conflict(ERRORS.accessKeys.keyAlreadyUsed);

    await req.repo
      .of<ProposalDoc>('proposals')
      .updateOne({ _id: doc.resourceId }, { $set: { buyerUserId: req.principal!.sub } });
    res.json({
      resourceType: doc.resourceType,
      resourceId: doc.resourceId,
    } satisfies ClaimResult);
  });

  return router;
};

/** Staff management of access keys: list, revoke, rotate. */
export const adminAccessKeyRoutes = ({ guards, now }: ModuleContext) => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...STAFF_ROLES));

  router.get('/', async (req, res) => {
    const q = parse(accessKeyListQuerySchema, req.query);
    const docs = await req.repo.of<AccessKeyDoc>('accessKeys').find(q, { sort: { createdAt: -1 } });
    res.json(docs.map(toKeyInfo));
  });

  router.post('/:id/revoke', async (req, res) => {
    const doc = await req.repo
      .of<AccessKeyDoc>('accessKeys')
      .findOneAndUpdate(
        { _id: req.params['id'] as string, status: AccessKeyStatus.Active },
        { $set: { status: AccessKeyStatus.Revoked } },
      );
    if (!doc) throw notFound();
    res.json(toKeyInfo(doc));
  });

  router.post('/:id/rotate', async (req, res) => {
    const old = await req.repo
      .of<AccessKeyDoc>('accessKeys')
      .findOneAndUpdate(
        { _id: req.params['id'] as string, status: AccessKeyStatus.Active },
        { $set: { status: AccessKeyStatus.Revoked } },
      );
    if (!old) throw notFound();
    const code = old.codeHash ? randomCode() : undefined;
    const { key, doc } = await createAccessKey(req.repo, old.resourceType, old.resourceId, {
      createdBy: req.principal!.sub,
      now: now(),
      ...(code && { code }),
      ...(old.signerId && { signerId: old.signerId }),
    });
    await setResourceKey(req.repo, doc, doc._id);
    res.status(201).json({
      accessKey: key,
      ...(code && { code }),
      key: toKeyInfo(doc),
    } satisfies AccessKeyRotated);
  });

  return router;
};
