import { Role } from '@homepact/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_TOKEN_TTL_S, REFRESH_TOKEN_TTL_S } from '../../../src/auth/tokens.js';
import { issueSession } from '../../../src/modules/auth/sessions.js';
import { toAuthUser } from '../../../src/modules/auth/users.js';
import { userDoc } from '../../support/fixtures.js';
import {
  COMPANY_ID,
  NOW,
  NOW_ISO,
  mockContext,
  mockRepo,
  type MockRepo,
} from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({
  newId: vi.fn(() => 'generated-id'),
  randomToken: vi.fn(() => 'opaque-refresh'),
  sha256: vi.fn((v: string) => `sha256(${v})`),
}));

let repo: MockRepo;
const { tokens } = mockContext();

beforeEach(() => {
  repo = mockRepo();
  tokens.sign.mockResolvedValue('jwt');
});

describe('toAuthUser', () => {
  it('never exposes the password hash', () => {
    const user = toAuthUser(userDoc({ phone: '555' }));
    expect(user).toEqual({
      id: 'buyer-1',
      email: 'bea@buyer.test',
      name: 'Bea Buyer',
      role: Role.Buyer,
      companyId: COMPANY_ID,
      active: true,
      createdAt: NOW_ISO,
      phone: '555',
    });
    expect(toAuthUser(userDoc())).not.toHaveProperty('phone');
  });
});

describe('issueSession', () => {
  it('signs an access token and stores only the hash of a new refresh token', async () => {
    const session = await issueSession(repo, tokens, userDoc(), NOW);
    expect(session).toEqual({
      accessToken: 'jwt',
      refreshToken: 'opaque-refresh',
      expiresIn: ACCESS_TOKEN_TTL_S,
      user: toAuthUser(userDoc()),
    });
    expect(tokens.sign).toHaveBeenCalledWith({
      sub: 'buyer-1',
      role: Role.Buyer,
      companyId: COMPANY_ID,
      name: 'Bea Buyer',
    });
    expect(repo.col('refreshTokens').insertOne).toHaveBeenCalledWith({
      _id: 'generated-id',
      hash: 'sha256(opaque-refresh)',
      userId: 'buyer-1',
      familyId: 'generated-id',
      expiresAt: new Date(NOW.getTime() + REFRESH_TOKEN_TTL_S * 1000),
      revoked: false,
    });
  });

  it('keeps the token family when rotating', async () => {
    await issueSession(repo, tokens, userDoc(), NOW, 'family-7');
    expect(repo.col('refreshTokens').insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ familyId: 'family-7' }),
    );
  });
});
