import {
  AccessKeyStatus,
  GuestRole,
  type AccessKeyInfo,
  type AccessResourceType,
} from '@homepact/shared';
import type { Request } from 'express';
import { newId, randomToken, sha256 } from '../../data/ids.js';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';
import { notFound } from '../../http/errors.js';

export interface AccessKeyDoc extends TenantDoc {
  hash: string;
  resourceType: AccessResourceType;
  resourceId: string;
  status: AccessKeyStatus;
  codeHash?: string;
  signerId?: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt?: string;
}

export const toKeyInfo = (k: AccessKeyDoc): AccessKeyInfo => ({
  id: k._id,
  resourceType: k.resourceType,
  resourceId: k.resourceId,
  status: k.status,
  ...(k.codeHash && { needsCode: true }),
  ...(k.signerId && { signerId: k.signerId }),
  createdAt: k.createdAt,
  ...(k.lastUsedAt && { lastUsedAt: k.lastUsedAt }),
});

/** Hash of a signing code, salted with the key it belongs to: codes are short on purpose. */
export const hashCode = (keyId: string, code: string): string =>
  sha256(`${keyId}:${code.trim().toUpperCase()}`);

export interface AccessKeyOptions {
  createdBy: string;
  now: Date;
  code?: string;
  signerId?: string;
}

/** 256-bit random key; only its SHA-256 is stored, the plaintext is returned exactly once. */
export const createAccessKey = async (
  repo: TenantRepo,
  resourceType: AccessResourceType,
  resourceId: string,
  { createdBy, now, code, signerId }: AccessKeyOptions,
): Promise<{ key: string; doc: AccessKeyDoc }> => {
  const key = randomToken(32);
  const _id = newId();
  const doc = await repo.of<AccessKeyDoc>('accessKeys').insertOne({
    _id,
    hash: sha256(key),
    resourceType,
    resourceId,
    status: AccessKeyStatus.Active,
    ...(code && { codeHash: hashCode(_id, code) }),
    ...(signerId && { signerId }),
    createdBy,
    createdAt: now.toISOString(),
  });
  return { key, doc };
};

/** Key-holder sessions die with their key: revocation takes effect immediately. */
export const assertKeyActive = async (req: Request): Promise<void> => {
  const p = req.principal;
  if (p?.role !== GuestRole.KeyHolder) return;
  const key = await req.repo
    .of<AccessKeyDoc>('accessKeys')
    .findOne({ _id: p.sub, status: AccessKeyStatus.Active });
  if (!key) throw notFound();
};
