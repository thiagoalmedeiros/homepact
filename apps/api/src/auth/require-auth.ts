import { isStaffRole, Role, type PrincipalRole } from '@homepact/shared';
import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from '../http/errors.js';
import type { Principal, TokenService } from './tokens.js';
import { ERRORS } from '../messages.js';

const bearer = (header: string | undefined): string | null => {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return m?.[1] ?? null;
};

/** The identity guard: a token is only valid for the tenant that issued it. */
const bindToTenant = (principal: Principal, tenantCompanyId: string | null): void => {
  if (principal.companyId !== tenantCompanyId) throw forbidden(ERRORS.auth.tokenWrongOrigin);
  if ((principal.role === Role.SuperAdmin) !== (tenantCompanyId === null)) {
    throw forbidden(ERRORS.auth.tokenWrongOrigin);
  }
};

export const createAuthGuards = (tokens: TokenService) => {
  const optionalAuth: RequestHandler = async (req, _res, next) => {
    const token = bearer(req.headers.authorization);
    if (token) {
      const principal = await tokens.verify(token);
      if (!principal) throw unauthorized(ERRORS.auth.invalidToken);
      bindToTenant(principal, req.tenant.companyId);
      req.principal = principal;
    }
    next();
  };

  const requireAuth: RequestHandler = async (req, res, next) => {
    await optionalAuth(req, res, () => undefined);
    if (!req.principal) throw unauthorized();
    next();
  };

  const requireRole =
    (...roles: PrincipalRole[]): RequestHandler =>
    (req, _res, next) => {
      if (!req.principal) throw unauthorized();
      if (!roles.includes(req.principal.role)) throw forbidden(ERRORS.auth.insufficientRole);
      next();
    };

  return { optionalAuth, requireAuth, requireRole };
};

export type AuthGuards = ReturnType<typeof createAuthGuards>;

export const isStaff = (p: Principal | undefined): boolean => isStaffRole(p?.role);
