import { normalizeOrigin } from '@homepact/shared';
import type { RequestHandler } from 'express';
import type { Db } from 'mongodb';
import { companiesCollection } from '../data/platform-repo.js';
import { forbidden } from '../http/errors.js';
import { ERRORS } from '../messages.js';

export type Tenant =
  | { kind: 'company'; companyId: string; origin: string }
  | { kind: 'platform'; companyId: null; origin: string };

export interface TenantResolver {
  resolve(origin: string | undefined): Promise<Tenant | null>;
  invalidate(): void;
}

const TTL_MS = 30_000;
const MAX_ENTRIES = 1_000;

/** Resolves the tenant of an Origin through a short-TTL cache invalidated on company writes. */
export const createTenantResolver = (
  db: Db,
  platformAdminOrigin: string,
  ttlMs = TTL_MS,
): TenantResolver => {
  const cache = new Map<string, { tenant: Tenant; expires: number }>();
  return {
    async resolve(rawOrigin) {
      if (!rawOrigin) return null;
      let origin: string;
      try {
        origin = normalizeOrigin(rawOrigin);
      } catch {
        return null;
      }
      if (origin === platformAdminOrigin) return { kind: 'platform', companyId: null, origin };
      const hit = cache.get(origin);
      if (hit && hit.expires > Date.now()) return hit.tenant;
      const company = await companiesCollection(db).findOne(
        { origins: origin, active: true },
        { projection: { _id: 1 } },
      );
      if (!company) return null; // never cache misses: arbitrary Origins must not grow memory
      const tenant: Tenant = { kind: 'company', companyId: company._id, origin };
      if (cache.size >= MAX_ENTRIES) cache.clear();
      cache.set(origin, { tenant, expires: Date.now() + ttlMs });
      return tenant;
    },
    invalidate: () => cache.clear(),
  };
};

/** Attributes every request to exactly one tenant by its Origin; unknown → 403. */
export const resolveTenant =
  (resolver: TenantResolver): RequestHandler =>
  async (req, _res, next) => {
    const tenant = await resolver.resolve(req.headers.origin);
    if (!tenant) throw forbidden(ERRORS.tenant.unknownOrigin);
    req.tenant = tenant;
    next();
  };
