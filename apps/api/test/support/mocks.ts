import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler, type Router } from 'express';
import type { Db } from 'mongodb';
import { vi, type Mock } from 'vitest';
import { AccessResourceType, GuestRole, Role, type PrincipalRole } from '@homepact/shared';
import type { AuthGuards } from '../../src/auth/require-auth.js';
import type { Principal, TokenService } from '../../src/auth/tokens.js';
import type { ModuleContext } from '../../src/context.js';
import type { CollectionName, TenantRepo } from '../../src/data/tenant-repo.js';
import { errorHandler, forbidden, unauthorized } from '../../src/http/errors.js';
import type { Tenant, TenantResolver } from '../../src/tenant/resolve-tenant.js';

export const COMPANY_ID = 'company-a';
export const NOW = new Date('2026-10-31T12:00:00.000Z');
export const NOW_ISO = NOW.toISOString();

export const COMPANY_TENANT: Tenant = {
  kind: 'company',
  companyId: COMPANY_ID,
  origin: 'http://a.test',
};
export const PLATFORM_TENANT: Tenant = {
  kind: 'platform',
  companyId: null,
  origin: 'http://admin.test',
};

const principal = (role: PrincipalRole, sub: string, name: string): Principal => ({
  sub,
  role,
  companyId: role === Role.SuperAdmin ? null : COMPANY_ID,
  name,
});
export const ADMIN = principal(Role.CompanyAdmin, 'admin-1', 'Alex Admin');
export const STAFF = principal(Role.CompanyStaff, 'staff-1', 'Sam Staff');
export const BUYER = principal(Role.Buyer, 'buyer-1', 'Bea Buyer');
export const SUPER_ADMIN = principal(Role.SuperAdmin, 'super-1', 'Platform Admin');
export const keyHolder = (proposalId: string): Principal => ({
  ...principal(GuestRole.KeyHolder, 'key-1', 'Guest'),
  resource: { type: AccessResourceType.Proposal, id: proposalId },
});

/** A purchaser on their own signing link (key + code), signing one agreement. */
export const agreementSigner = (agreementId: string, purchaserId: string): Principal => ({
  ...principal(GuestRole.KeyHolder, 'key-sign-1', 'Guest'),
  resource: { type: AccessResourceType.Agreement, id: agreementId },
  signerId: purchaserId,
});

export interface MockCollection {
  find: Mock;
  findOne: Mock;
  insertOne: Mock;
  updateOne: Mock;
  findOneAndUpdate: Mock;
  updateMany: Mock;
  deleteOne: Mock;
  countDocuments: Mock;
}

export const mockCollection = (companyId: string | null = COMPANY_ID): MockCollection => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn().mockResolvedValue(null),
  insertOne: vi.fn(async (doc: object) => ({ ...doc, companyId })),
  updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  findOneAndUpdate: vi.fn().mockResolvedValue(null),
  updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  countDocuments: vi.fn().mockResolvedValue(0),
});

export interface MockRepo extends TenantRepo {
  of: Mock & TenantRepo['of'];
  col(name: CollectionName): MockCollection;
}

export const mockRepo = (companyId: string | null = COMPANY_ID): MockRepo => {
  const cols = new Map<CollectionName, MockCollection>();
  const col = (name: CollectionName): MockCollection => {
    let c = cols.get(name);
    if (!c) {
      c = mockCollection(companyId);
      cols.set(name, c);
    }
    return c;
  };
  return { companyId, of: vi.fn(col) as unknown as MockRepo['of'], col };
};

/** Auth guards stand-in: enforces "signed in" and the role list, nothing else. */
export const mockGuards = (): AuthGuards => {
  const requireAuth: RequestHandler = (req, _res, next) => {
    if (!req.principal) throw unauthorized();
    next();
  };
  return {
    optionalAuth: vi.fn((_req, _res, next) => next()) as unknown as RequestHandler,
    requireAuth: vi.fn(requireAuth) as unknown as RequestHandler,
    requireRole: vi.fn((...roles: PrincipalRole[]): RequestHandler => (req, _res, next) => {
      if (!req.principal) throw unauthorized();
      if (!roles.includes(req.principal.role)) throw forbidden('Insufficient role');
      next();
    }),
  };
};

export interface MockContext extends ModuleContext {
  tokens: { sign: Mock & TokenService['sign']; verify: Mock & TokenService['verify'] };
  resolver: { resolve: Mock & TenantResolver['resolve']; invalidate: Mock & (() => void) };
  signatures: { id: string; invite: Mock; revoke: Mock; capture: Mock };
}

/** A signature service stand-in: the routes only ever talk to this interface. */
export const mockSignatures = (): MockContext['signatures'] => ({
  id: 'test-provider',
  invite: vi.fn(async (_ctx, _envelope, signers: { id: string; name: string }[]) =>
    signers.map((s) => ({
      purchaserId: s.id,
      name: s.name,
      key: `key-${s.id}`,
      code: 'AAAA-BBBB',
    })),
  ),
  revoke: vi.fn(async () => {}),
  capture: vi.fn(
    async (
      _ctx,
      envelope: { contentHash: string },
      _signer,
      submission: { fullName: string; initials: number[]; ip?: string },
    ) => ({
      fullName: submission.fullName,
      signedAt: NOW_ISO,
      contentHash: envelope.contentHash,
      ...(submission.ip && { ip: submission.ip }),
      provider: 'test-provider',
      ...(submission.initials.length && { initials: submission.initials }),
    }),
  ),
});

export const mockContext = (overrides: Partial<ModuleContext> = {}): MockContext =>
  ({
    db: {} as Db,
    tokens: {
      sign: vi.fn().mockResolvedValue('signed-access-token'),
      verify: vi.fn().mockResolvedValue(null),
    },
    guards: mockGuards(),
    resolver: { resolve: vi.fn().mockResolvedValue(null), invalidate: vi.fn() },
    now: () => NOW,
    accessKeyRateLimit: { windowMs: 60_000, max: 1_000 },
    signatures: mockSignatures(),
    rates: {
      name: 'Test rates',
      seriesUrl: vi.fn(() => 'https://rates.test'),
      fetchSeries: vi.fn(),
    },
    ...overrides,
  }) as MockContext;

export interface Scene {
  tenant: Tenant;
  repo: TenantRepo;
  principal?: Principal;
}

export interface Reply {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Headers;
}

export interface Harness {
  call(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Reply>;
  logError: Mock;
  logWarn: Mock;
  close(): Promise<void>;
}

/** Serves one router on a local port with the tenant, repo and principal of `scene`, and the
 * real error handler. */
export const serveRouter = async (router: Router, scene: Scene): Promise<Harness> => {
  const logError = vi.fn();
  const logWarn = vi.fn();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenant = scene.tenant;
    req.repo = scene.repo;
    if (scene.principal) req.principal = scene.principal;
    (req as unknown as { log: { error: Mock; warn: Mock } }).log = {
      error: logError,
      warn: logWarn,
    };
    next();
  });
  app.use(router);
  app.use(errorHandler);
  return serveApp(app, logError, logWarn);
};

export const serveApp = async (
  app: express.Express,
  logError: Mock = vi.fn(),
  logWarn: Mock = vi.fn(),
): Promise<Harness> => {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    logError,
    logWarn,
    async call(method, path, rawBody, headers = {}) {
      const body = method === 'GET' || method === 'HEAD' ? undefined : rawBody;
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: res.status, body: parsed, headers: res.headers };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
