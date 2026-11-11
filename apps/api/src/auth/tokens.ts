import type { AccessResourceType, PrincipalRole } from '@homepact/shared';
import { jwtVerify, SignJWT } from 'jose';

export interface Principal {
  sub: string;
  role: PrincipalRole;
  companyId: string | null;
  name: string;
  resource?: { type: AccessResourceType; id: string };
  signerId?: string;
}

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const KEY_SESSION_TTL_S = 2 * 60 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

export interface TokenService {
  sign(principal: Principal, ttlSeconds?: number): Promise<string>;
  verify(token: string): Promise<Principal | null>;
}

export const createTokenService = (secret: string): TokenService => {
  const key = new TextEncoder().encode(secret);
  return {
    sign: ({ sub, role, companyId, name, resource, signerId }, ttlSeconds = ACCESS_TOKEN_TTL_S) =>
      new SignJWT({
        role,
        companyId,
        name,
        ...(resource && { res: resource }),
        ...(signerId && { sid: signerId }),
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key),
    verify: async (token) => {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        if (typeof payload.sub !== 'string' || typeof payload['role'] !== 'string') return null;
        return {
          sub: payload.sub,
          role: payload['role'] as PrincipalRole,
          companyId: (payload['companyId'] as string | null) ?? null,
          name: String(payload['name'] ?? ''),
          ...(payload['res'] ? { resource: payload['res'] as Principal['resource'] } : {}),
          ...(payload['sid'] ? { signerId: String(payload['sid']) } : {}),
        };
      } catch {
        return null;
      }
    },
  };
};
