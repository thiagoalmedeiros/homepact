import { Role } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../../src/auth/passwords.js';
import { companiesCollection } from '../../../src/data/platform-repo.js';
import { tenantRepo } from '../../../src/data/tenant-repo.js';
import { toAuthUser } from '../../../src/modules/auth/users.js';
import { companyRoutes, toCompany } from '../../../src/modules/companies/routes.js';
import {
  ADMIN,
  NOW_ISO,
  PLATFORM_TENANT,
  SUPER_ADMIN,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockContext,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/auth/passwords.js', () => ({ hashPassword: vi.fn() }));
vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'new-id') }));
vi.mock('../../../src/data/platform-repo.js', () => ({ companiesCollection: vi.fn() }));
vi.mock('../../../src/data/tenant-repo.js', () => ({ tenantRepo: vi.fn() }));
vi.mock('../../../src/modules/auth/users.js', () => ({ toAuthUser: vi.fn() }));

const company = {
  _id: 'co-1',
  name: 'Alpha Homes',
  slug: 'alpha',
  logoUrl: 'https://img.test/logo.png',
  origins: ['http://a.test'],
  currency: 'CAD' as const,
  active: true,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
};
const input = {
  name: 'Alpha Homes',
  slug: 'alpha',
  logoUrl: 'https://img.test/logo.png',
  origins: ['http://A.test/', 'http://a.test'],
};

const companies = {
  find: vi.fn(),
  findOne: vi.fn(),
  insertOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
};
let h: Harness;
let ctx: MockContext;
let scene: Scene;
let newTenant: MockRepo;

beforeEach(async () => {
  vi.mocked(companiesCollection).mockReturnValue(companies as never);
  companies.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([company]) });
  companies.insertOne.mockResolvedValue({ acknowledged: true });
  newTenant = mockRepo('co-1');
  vi.mocked(tenantRepo).mockReturnValue(newTenant);
  vi.mocked(hashPassword).mockResolvedValue('hashed');
  vi.mocked(toAuthUser).mockImplementation((u) => ({ id: u._id }) as never);
  ctx = mockContext();
  scene = { tenant: PLATFORM_TENANT, repo: mockRepo(null), principal: SUPER_ADMIN };
  h = await serveRouter(companyRoutes(ctx), scene);
});
afterEach(() => h.close());

it('toCompany exposes _id as id', () => {
  const { _id, ...rest } = company;
  expect(toCompany(company)).toEqual({ id: _id, ...rest });
});

it('every endpoint is super-admin only', async () => {
  scene.principal = ADMIN;
  for (const [method, path] of [
    ['GET', '/'],
    ['POST', '/'],
    ['GET', '/co-1'],
    ['PATCH', '/co-1'],
    ['POST', '/co-1/admins'],
  ] as const) {
    expect((await h.call(method, path, {})).status, `${method} ${path}`).toBe(403);
  }
  expect(companies.find).not.toHaveBeenCalled();
});

describe('GET /platform/companies', () => {
  it('lists companies by name', async () => {
    expect((await h.call('GET', '/')).body).toEqual([toCompany(company)]);
    expect(companies.find).toHaveBeenCalledWith({}, { sort: { name: 1 } });
  });

  it('reads one company or 404', async () => {
    companies.findOne.mockResolvedValueOnce(company).mockResolvedValueOnce(null);
    expect((await h.call('GET', '/co-1')).body).toEqual(toCompany(company));
    expect(companies.findOne).toHaveBeenCalledWith({ _id: 'co-1' });
    expect((await h.call('GET', '/nope')).status).toBe(404);
  });
});

describe('POST /platform/companies', () => {
  it('creates a company with normalized, unique origins and refreshes tenant resolution', async () => {
    const res = await h.call('POST', '/', input);
    const stored = {
      _id: 'new-id',
      ...input,
      origins: ['http://a.test'],
      currency: 'CAD',
      active: true,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };
    const { _id, ...rest } = stored;
    expect(res).toMatchObject({ status: 201, body: { id: _id, ...rest } });
    expect(companies.insertOne).toHaveBeenCalledWith(stored);
    expect(ctx.resolver.invalidate).toHaveBeenCalled();
  });

  it('a taken origin or slug is a 409 (and the cache is still refreshed)', async () => {
    companies.insertOne.mockRejectedValue({ code: 11000 });
    expect(await h.call('POST', '/', input)).toMatchObject({
      status: 409,
      body: { error: 'Origin or slug already belongs to a company' },
    });
    expect(ctx.resolver.invalidate).toHaveBeenCalled();
  });

  it('validates input and lets other errors through', async () => {
    expect((await h.call('POST', '/', { ...input, origins: ['ftp://x'] })).status).toBe(400);
    companies.insertOne.mockRejectedValue(new Error('boom'));
    expect((await h.call('POST', '/', input)).status).toBe(500);
  });
});

describe('PATCH /platform/companies/:id', () => {
  it('updates only the sent fields, normalizing origins', async () => {
    companies.findOneAndUpdate.mockResolvedValue({ ...company, name: 'Renamed' });
    const res = await h.call('PATCH', '/co-1', { name: 'Renamed', origins: ['http://B.test'] });
    expect(res.body).toMatchObject({ id: 'co-1', name: 'Renamed' });
    expect(companies.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'co-1' },
      { $set: { name: 'Renamed', origins: ['http://b.test'], updatedAt: NOW_ISO } },
      { returnDocument: 'after' },
    );
    expect(ctx.resolver.invalidate).toHaveBeenCalled();
  });

  it('is a 404 for an unknown company and 409 for a taken origin', async () => {
    companies.findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await h.call('PATCH', '/nope', { name: 'X Co' })).status).toBe(404);
    companies.findOneAndUpdate.mockRejectedValueOnce({ code: 11000 });
    expect((await h.call('PATCH', '/co-1', { origins: ['http://b.test'] })).status).toBe(409);
    companies.findOneAndUpdate.mockRejectedValueOnce(new Error('boom'));
    expect((await h.call('PATCH', '/co-1', { name: 'X Co' })).status).toBe(500);
  });
});

describe('POST /platform/companies/:id/admins', () => {
  const admin = { name: 'First Admin', email: 'First@Alpha.test', password: 'long-password' };

  it("creates the company's first admin inside that company's tenant", async () => {
    companies.findOne.mockResolvedValue(company);
    const res = await h.call('POST', '/co-1/admins', { ...admin, phone: '555' });
    expect(res).toMatchObject({ status: 201, body: { id: 'new-id' } });
    expect(tenantRepo).toHaveBeenCalledWith(ctx.db, 'co-1');
    expect(newTenant.col('users').insertOne).toHaveBeenCalledWith({
      _id: 'new-id',
      email: 'first@alpha.test',
      name: 'First Admin',
      role: Role.CompanyAdmin,
      passwordHash: 'hashed',
      active: true,
      createdAt: NOW_ISO,
      phone: '555',
    });
  });

  it('is a 404 for an unknown company, 400 for bad input and 409 for a taken email', async () => {
    companies.findOne.mockResolvedValueOnce(null);
    expect((await h.call('POST', '/nope/admins', admin)).status).toBe(404);
    companies.findOne.mockResolvedValue(company);
    expect((await h.call('POST', '/co-1/admins', { ...admin, password: 'short' })).status).toBe(
      400,
    );
    newTenant.col('users').insertOne.mockRejectedValueOnce({ code: 11000 });
    expect((await h.call('POST', '/co-1/admins', admin)).status).toBe(409);
    newTenant.col('users').insertOne.mockRejectedValueOnce(new Error('boom'));
    expect((await h.call('POST', '/co-1/admins', admin)).status).toBe(500);
  });
});
