import { Role, STAFF_ROLES } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../../src/auth/passwords.js';
import { toAuthUser } from '../../../src/modules/auth/users.js';
import { userRoutes } from '../../../src/modules/users/routes.js';
import { userDoc } from '../../support/fixtures.js';
import {
  ADMIN,
  BUYER,
  COMPANY_TENANT,
  NOW_ISO,
  STAFF,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/auth/passwords.js', () => ({ hashPassword: vi.fn() }));
vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'user-new') }));
vi.mock('../../../src/modules/auth/users.js', () => ({ toAuthUser: vi.fn() }));

const STAFF_FILTER = { role: { $in: [...STAFF_ROLES] } };
let h: Harness;
let repo: MockRepo;
let scene: Scene;

beforeEach(async () => {
  repo = mockRepo();
  scene = { tenant: COMPANY_TENANT, repo, principal: ADMIN };
  vi.mocked(hashPassword).mockResolvedValue('hashed');
  vi.mocked(toAuthUser).mockImplementation((u) => ({ id: u._id, mapped: true }) as never);
  h = await serveRouter(userRoutes(mockContext()), scene);
});
afterEach(() => h.close());

describe('GET /users', () => {
  it('lists the company team (staff roles only) sorted by name', async () => {
    repo.col('users').find.mockResolvedValue([userDoc({ _id: 'u1' }), userDoc({ _id: 'u2' })]);
    scene.principal = STAFF;
    const res = await h.call('GET', '/');
    expect(res).toMatchObject({ status: 200, body: [{ id: 'u1' }, { id: 'u2' }] });
    expect(repo.col('users').find).toHaveBeenCalledWith(STAFF_FILTER, { sort: { name: 1 } });
  });

  it('is staff-only', async () => {
    scene.principal = BUYER;
    expect((await h.call('GET', '/')).status).toBe(403);
    delete scene.principal;
    expect((await h.call('GET', '/')).status).toBe(401);
  });
});

describe('POST /users', () => {
  const body = {
    name: 'New Staff',
    email: 'New@Alpha.test',
    password: 'long-password',
    role: Role.CompanyStaff,
  };

  it('admins create team members with a hashed password', async () => {
    const res = await h.call('POST', '/', { ...body, phone: '555' });
    expect(res).toMatchObject({ status: 201, body: { id: 'user-new', mapped: true } });
    expect(hashPassword).toHaveBeenCalledWith('long-password');
    expect(repo.col('users').insertOne).toHaveBeenCalledWith({
      _id: 'user-new',
      email: 'new@alpha.test',
      name: 'New Staff',
      role: Role.CompanyStaff,
      passwordHash: 'hashed',
      active: true,
      createdAt: NOW_ISO,
      phone: '555',
    });
    expect(JSON.stringify(res.body)).not.toContain('long-password');
  });

  it('staff cannot create users', async () => {
    scene.principal = STAFF;
    expect((await h.call('POST', '/', body)).status).toBe(403);
    expect(repo.col('users').insertOne).not.toHaveBeenCalled();
  });

  it('validates input (400) and reports a taken email (409)', async () => {
    expect((await h.call('POST', '/', { ...body, role: Role.Buyer })).status).toBe(400);
    repo.col('users').insertOne.mockRejectedValue({ code: 11000 });
    expect(await h.call('POST', '/', body)).toMatchObject({
      status: 409,
      body: { error: 'An account with this email already exists' },
    });
  });

  it('lets unexpected storage errors become a 500', async () => {
    repo.col('users').insertOne.mockRejectedValue(new Error('disk full'));
    expect((await h.call('POST', '/', body)).status).toBe(500);
  });
});

describe('PATCH /users/:id', () => {
  it('updates a team member', async () => {
    repo.col('users').findOneAndUpdate.mockResolvedValue(userDoc({ _id: 'staff-1' }));
    const res = await h.call('PATCH', '/staff-1', { role: Role.CompanyAdmin });
    expect(res).toMatchObject({ status: 200, body: { id: 'staff-1' } });
    expect(repo.col('users').findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'staff-1', ...STAFF_FILTER },
      { $set: { role: Role.CompanyAdmin } },
    );
  });

  it('admins cannot deactivate or demote themselves', async () => {
    for (const change of [{ active: false }, { role: Role.CompanyStaff }]) {
      expect(await h.call('PATCH', `/${ADMIN.sub}`, change)).toMatchObject({
        status: 400,
        body: { error: 'You cannot deactivate or demote yourself' },
      });
    }
    repo.col('users').findOneAndUpdate.mockResolvedValue(userDoc({ _id: ADMIN.sub }));
    expect((await h.call('PATCH', `/${ADMIN.sub}`, { name: 'Renamed' })).status).toBe(200);
  });

  it('is a 404 for buyers or unknown users, and admin-only', async () => {
    expect((await h.call('PATCH', '/buyer-1', { active: false })).status).toBe(404);
    scene.principal = STAFF;
    expect((await h.call('PATCH', '/staff-2', { active: false })).status).toBe(403);
  });
});
