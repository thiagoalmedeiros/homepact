import { Role } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/auth/passwords.js';
import { authRoutes } from '../../../src/modules/auth/routes.js';
import { issueSession } from '../../../src/modules/auth/sessions.js';
import { toAuthUser } from '../../../src/modules/auth/users.js';
import { refreshTokenDoc, userDoc } from '../../support/fixtures.js';
import {
  BUYER,
  COMPANY_TENANT,
  NOW,
  NOW_ISO,
  PLATFORM_TENANT,
  SUPER_ADMIN,
  keyHolder,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockContext,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/auth/passwords.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock('../../../src/data/ids.js', () => ({
  newId: vi.fn(() => 'user-new'),
  sha256: vi.fn((v: string) => `sha256(${v})`),
}));
vi.mock('../../../src/modules/auth/sessions.js', () => ({ issueSession: vi.fn() }));
vi.mock('../../../src/modules/auth/users.js', () => ({ toAuthUser: vi.fn() }));

const SESSION = { accessToken: 'jwt', refreshToken: 'rt', expiresIn: 900, user: { id: 'u' } };
let h: Harness;
let repo: MockRepo;
let scene: Scene;
let ctx: MockContext;

beforeEach(async () => {
  repo = mockRepo();
  ctx = mockContext();
  scene = { tenant: COMPANY_TENANT, repo };
  vi.mocked(hashPassword).mockResolvedValue('hashed');
  vi.mocked(verifyPassword).mockResolvedValue(true);
  vi.mocked(issueSession).mockResolvedValue(SESSION as never);
  vi.mocked(toAuthUser).mockImplementation((u) => ({ id: u._id }) as never);
  h = await serveRouter(authRoutes(ctx), scene);
});
afterEach(() => h.close());

describe('POST /auth/register', () => {
  const body = { name: 'Bea Buyer', email: 'Bea@Buyer.test', password: 'long-password' };

  it('registers a buyer on a company site and opens a session', async () => {
    expect(await h.call('POST', '/register', { ...body, phone: '555' })).toMatchObject({
      status: 201,
      body: SESSION,
    });
    const user = {
      _id: 'user-new',
      email: 'bea@buyer.test',
      name: 'Bea Buyer',
      role: Role.Buyer,
      passwordHash: 'hashed',
      active: true,
      createdAt: NOW_ISO,
      phone: '555',
    };
    expect(repo.col('users').insertOne).toHaveBeenCalledWith(user);
    expect(issueSession).toHaveBeenCalledWith(
      repo,
      ctx.tokens,
      { ...user, companyId: 'company-a' },
      NOW,
    );
  });

  it('is closed on the platform origin (403)', async () => {
    scene.tenant = PLATFORM_TENANT;
    expect((await h.call('POST', '/register', body)).status).toBe(403);
    expect(repo.col('users').insertOne).not.toHaveBeenCalled();
  });

  it('a taken email is a 409, a weak password a 400 that never echoes it', async () => {
    repo.col('users').insertOne.mockRejectedValueOnce({ code: 11000 });
    expect(await h.call('POST', '/register', body)).toMatchObject({
      status: 409,
      body: { error: 'An account with this email already exists' },
    });
    const res = await h.call('POST', '/register', { ...body, password: 'pw123' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('pw123');
    repo.col('users').insertOne.mockRejectedValueOnce(new Error('boom'));
    expect((await h.call('POST', '/register', body)).status).toBe(500);
  });
});

describe('POST /auth/login', () => {
  const body = { email: 'bea@buyer.test', password: 'long-password' };

  it('opens a session for the right password', async () => {
    repo.col('users').findOne.mockResolvedValue(userDoc());
    expect((await h.call('POST', '/login', body)).body).toEqual(SESSION);
    expect(repo.col('users').findOne).toHaveBeenCalledWith({ email: 'bea@buyer.test' });
    expect(verifyPassword).toHaveBeenCalledWith('long-password', 'scrypt$salt$hash');
    expect(issueSession).toHaveBeenCalledWith(repo, ctx.tokens, userDoc(), NOW);
  });

  it('gives one answer for unknown users, wrong passwords and inactive accounts', async () => {
    const expected = { status: 401, body: { error: 'Incorrect email or password' } };
    expect(await h.call('POST', '/login', body)).toMatchObject(expected);
    expect(verifyPassword).toHaveBeenCalledWith(
      'long-password',
      expect.stringMatching(/^scrypt\$/),
    );

    repo.col('users').findOne.mockResolvedValue(userDoc());
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);
    expect(await h.call('POST', '/login', body)).toMatchObject(expected);

    repo.col('users').findOne.mockResolvedValue(userDoc({ active: false }));
    expect(await h.call('POST', '/login', body)).toMatchObject(expected);
    expect(issueSession).not.toHaveBeenCalled();
  });

  it('super-admins sign in on the platform origin only, everyone else off it', async () => {
    repo
      .col('users')
      .findOne.mockResolvedValue(userDoc({ role: Role.SuperAdmin, companyId: null }));
    expect((await h.call('POST', '/login', body)).status).toBe(401);
    scene.tenant = PLATFORM_TENANT;
    expect((await h.call('POST', '/login', body)).status).toBe(200);
    repo.col('users').findOne.mockResolvedValue(userDoc());
    expect((await h.call('POST', '/login', body)).status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  const body = { refreshToken: 'opaque-refresh' };
  const tokens = () => repo.col('refreshTokens');

  beforeEach(() => {
    tokens().findOne.mockResolvedValue(refreshTokenDoc());
    repo.col('users').findOne.mockResolvedValue(userDoc());
  });

  it('rotates: marks the token used and issues a new one in the same family', async () => {
    expect((await h.call('POST', '/refresh', body)).body).toEqual(SESSION);
    expect(tokens().findOne).toHaveBeenCalledWith({ hash: 'sha256(opaque-refresh)' });
    expect(tokens().updateOne).toHaveBeenCalledWith(
      { _id: 'rt-1', usedAt: { $exists: false } },
      { $set: { usedAt: NOW } },
    );
    expect(repo.col('users').findOne).toHaveBeenCalledWith({ _id: 'buyer-1', active: true });
    expect(issueSession).toHaveBeenCalledWith(repo, ctx.tokens, userDoc(), NOW, 'family-1');
  });

  it('refuses unknown, revoked and expired tokens', async () => {
    for (const record of [
      null,
      refreshTokenDoc({ revoked: true }),
      refreshTokenDoc({ expiresAt: new Date(NOW.getTime() - 1) }),
    ]) {
      tokens().findOne.mockResolvedValueOnce(record);
      expect(await h.call('POST', '/refresh', body)).toMatchObject({
        status: 401,
        body: { error: 'Invalid refresh token' },
      });
    }
    expect(issueSession).not.toHaveBeenCalled();
  });

  it('reusing a used token revokes the whole family', async () => {
    tokens().updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    expect(await h.call('POST', '/refresh', body)).toMatchObject({
      status: 401,
      body: { error: 'Refresh token reuse detected' },
    });
    expect(tokens().updateMany).toHaveBeenCalledWith(
      { familyId: 'family-1' },
      { $set: { revoked: true } },
    );
    expect(issueSession).not.toHaveBeenCalled();
  });

  it('a reuse that raced the rotation still revokes the family and fails', async () => {
    tokens().countDocuments.mockResolvedValue(1);
    expect((await h.call('POST', '/refresh', body)).status).toBe(401);
    expect(tokens().countDocuments).toHaveBeenCalledWith({ familyId: 'family-1', revoked: true });
    expect(tokens().updateMany).toHaveBeenCalledWith(
      { familyId: 'family-1' },
      { $set: { revoked: true } },
    );
  });

  it('a deactivated user cannot refresh', async () => {
    repo.col('users').findOne.mockResolvedValue(null);
    expect((await h.call('POST', '/refresh', body)).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the token family', async () => {
    repo.col('refreshTokens').findOne.mockResolvedValue(refreshTokenDoc());
    expect((await h.call('POST', '/logout', { refreshToken: 'rt' })).status).toBe(204);
    expect(repo.col('refreshTokens').updateMany).toHaveBeenCalledWith(
      { familyId: 'family-1' },
      { $set: { revoked: true } },
    );
  });

  it('succeeds quietly for an unknown token', async () => {
    expect((await h.call('POST', '/logout', { refreshToken: 'rt' })).status).toBe(204);
    expect(repo.col('refreshTokens').updateMany).not.toHaveBeenCalled();
    expect((await h.call('POST', '/logout', {})).status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('returns the signed-in user', async () => {
    scene.principal = BUYER;
    repo.col('users').findOne.mockResolvedValue(userDoc());
    expect((await h.call('GET', '/me')).body).toEqual({ id: 'buyer-1' });
    expect(repo.col('users').findOne).toHaveBeenCalledWith({ _id: 'buyer-1' });
  });

  it('is a 401 anonymously and a 404 for key holders or vanished users', async () => {
    expect((await h.call('GET', '/me')).status).toBe(401);
    scene.principal = keyHolder('proposal-1');
    expect((await h.call('GET', '/me')).status).toBe(404);
    scene.principal = SUPER_ADMIN;
    expect((await h.call('GET', '/me')).status).toBe(404);
  });
});
