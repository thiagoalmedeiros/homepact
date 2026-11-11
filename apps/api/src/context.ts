import type { Db } from 'mongodb';
import type { AuthGuards } from './auth/require-auth.js';
import type { TokenService } from './auth/tokens.js';
import type { SignatureProvider } from './modules/agreements/signature-provider.js';
import type { RateSource } from './modules/market-rates/source.js';
import type { TenantResolver } from './tenant/resolve-tenant.js';

export interface ModuleContext {
  db: Db;
  tokens: TokenService;
  guards: AuthGuards;
  resolver: TenantResolver;
  now: () => Date;
  accessKeyRateLimit: { windowMs: number; max: number };
  signatures: SignatureProvider;
  rates: RateSource;
}
