import { Role } from '@homepact/shared';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createAuthGuards, isStaff } from '../../src/auth/require-auth.js';
import type { Principal } from '../../src/auth/tokens.js';
import type { Tenant } from '../../src/tenant/resolve-tenant.js';
import {
  ADMIN,
  BUYER,
  COMPANY_TENANT,
  PLATFORM_TENANT,
  STAFF,
  SUPER_ADMIN,
  keyHolder,
  mockContext,
} from '../support/mocks.js';

/** The token service is mocked: `verify` returns whatever principal the test wants. */
const setup = (verified: Principal | null) => {
  const { tokens } = mockContext();
  tokens.verify.mockResolvedValue(verified);
  return { tokens, guards: createAuthGuards(tokens) };
};

const request = (tenant: Tenant, authorization?: string) =>
  ({ tenant, headers: authorization ? { authorization } : {} }) as unknown as Request;

const run = async (
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
  req: Request,
) => {
  const next = vi.fn();
  await handler(req, {} as Response, next);
  return next;
};

describe('optionalAuth', () => {
  it('lets anonymous requests through without a principal', async () => {
    const { guards, tokens } = setup(null);
    const req = request(COMPANY_TENANT);
    expect(await run(guards.optionalAuth, req)).toHaveBeenCalled();
    expect(req.principal).toBeUndefined();
    expect(tokens.verify).not.toHaveBeenCalled();
  });

  it('attaches the principal of a valid bearer token (any casing of "Bearer")', async () => {
    const { guards, tokens } = setup(BUYER);
    const req = request(COMPANY_TENANT, 'bearer  the-token');
    expect(await run(guards.optionalAuth, req)).toHaveBeenCalled();
    expect(tokens.verify).toHaveBeenCalledWith('the-token');
    expect(req.principal).toEqual(BUYER);
  });

  it('ignores non-bearer authorization headers', async () => {
    const { guards, tokens } = setup(BUYER);
    const req = request(COMPANY_TENANT, 'Basic abc');
    await run(guards.optionalAuth, req);
    expect(tokens.verify).not.toHaveBeenCalled();
    expect(req.principal).toBeUndefined();
  });

  it('rejects an invalid or expired token with 401', async () => {
    const { guards } = setup(null);
    await expect(
      run(guards.optionalAuth, request(COMPANY_TENANT, 'Bearer bad')),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid or expired token' });
  });

  it("refuses a company token on another company's origin (identity guard)", async () => {
    const { guards } = setup({ ...BUYER, companyId: 'company-b' });
    await expect(
      run(guards.optionalAuth, request(COMPANY_TENANT, 'Bearer t')),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Token not valid for this origin',
    });
  });

  it('keeps super-admin tokens on the platform origin and company tokens off it', async () => {
    await expect(
      run(setup(SUPER_ADMIN).guards.optionalAuth, request(COMPANY_TENANT, 'Bearer t')),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      run(
        setup({ ...BUYER, companyId: null }).guards.optionalAuth,
        request(PLATFORM_TENANT, 'Bearer t'),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      run(
        setup({ ...SUPER_ADMIN, companyId: COMPANY_TENANT.companyId }).guards.optionalAuth,
        request(COMPANY_TENANT, 'Bearer t'),
      ),
    ).rejects.toMatchObject({ status: 403 });

    const req = request(PLATFORM_TENANT, 'Bearer t');
    await run(setup(SUPER_ADMIN).guards.optionalAuth, req);
    expect(req.principal).toEqual(SUPER_ADMIN);
  });
});

describe('requireAuth', () => {
  it('requires a principal (401 when anonymous)', async () => {
    await expect(
      run(setup(null).guards.requireAuth, request(COMPANY_TENANT)),
    ).rejects.toMatchObject({
      status: 401,
      message: 'Authentication required',
    });
  });

  it('passes with a valid token', async () => {
    const req = request(COMPANY_TENANT, 'Bearer t');
    expect(await run(setup(STAFF).guards.requireAuth, req)).toHaveBeenCalledTimes(1);
    expect(req.principal).toEqual(STAFF);
  });
});

describe('requireRole', () => {
  const { guards } = setup(null);
  const withPrincipal = (p?: Principal) => ({ principal: p }) as unknown as Request;

  it('admits only the listed roles', async () => {
    const staffOnly = guards.requireRole(Role.CompanyAdmin, Role.CompanyStaff);
    expect(await run(staffOnly, withPrincipal(ADMIN))).toHaveBeenCalled();
    expect(await run(staffOnly, withPrincipal(STAFF))).toHaveBeenCalled();
    await expect(run(staffOnly, withPrincipal(BUYER))).rejects.toMatchObject({
      status: 403,
      message: 'Insufficient role',
    });
    await expect(run(staffOnly, withPrincipal(keyHolder('p')))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('is a 401 without a principal', async () => {
    await expect(run(guards.requireRole(Role.Buyer), withPrincipal())).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('isStaff', () => {
  it('is true for company admins and staff only', () => {
    expect(isStaff(ADMIN)).toBe(true);
    expect(isStaff(STAFF)).toBe(true);
    expect(isStaff(BUYER)).toBe(false);
    expect(isStaff(SUPER_ADMIN)).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });
});
