import type { Principal } from './auth/tokens.js';
import type { TenantRepo } from './data/tenant-repo.js';
import type { Tenant } from './tenant/resolve-tenant.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant: Tenant;
      principal?: Principal;
      repo: TenantRepo;
    }
  }
}

export {};
