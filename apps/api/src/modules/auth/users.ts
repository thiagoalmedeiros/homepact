import type { AuthUser, Role } from '@homepact/shared';
import type { TenantDoc } from '../../data/tenant-repo.js';

export interface UserDoc extends TenantDoc {
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  phone?: string;
  active: boolean;
  createdAt: string;
}

export const toAuthUser = (u: UserDoc): AuthUser => ({
  id: u._id,
  email: u.email,
  name: u.name,
  role: u.role,
  companyId: u.companyId,
  active: u.active,
  createdAt: u.createdAt,
  ...(u.phone && { phone: u.phone }),
});
