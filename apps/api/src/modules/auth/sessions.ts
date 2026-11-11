import type { AuthResponse } from '@homepact/shared';
import { newId, randomToken, sha256 } from '../../data/ids.js';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';
import { ACCESS_TOKEN_TTL_S, REFRESH_TOKEN_TTL_S, type TokenService } from '../../auth/tokens.js';
import { toAuthUser, type UserDoc } from './users.js';

export interface RefreshTokenDoc extends TenantDoc {
  hash: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  usedAt?: Date;
  revoked: boolean;
}

/** Issues an access token and a new opaque refresh token (stored hashed) in a token family. */
export const issueSession = async (
  repo: TenantRepo,
  tokens: TokenService,
  user: UserDoc,
  now: Date,
  familyId: string = newId(),
): Promise<AuthResponse> => {
  const refreshToken = randomToken();
  await repo.of<RefreshTokenDoc>('refreshTokens').insertOne({
    _id: newId(),
    hash: sha256(refreshToken),
    userId: user._id,
    familyId,
    expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000),
    revoked: false,
  });
  const accessToken = await tokens.sign({
    sub: user._id,
    role: user.role,
    companyId: user.companyId,
    name: user.name,
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_S, user: toAuthUser(user) };
};
