import './types.js';
import type { ApiInfo } from '@homepact/shared';
import express, { type Express } from 'express';
import type { Db } from 'mongodb';
import { pinoHttp } from 'pino-http';
import { createAuthGuards } from './auth/require-auth.js';
import { createTokenService } from './auth/tokens.js';
import type { ModuleContext } from './context.js';
import {
  builtInSignatureProvider,
  type SignatureProvider,
} from './modules/agreements/signature-provider.js';
import { tenantRepo } from './data/tenant-repo.js';
import { errorHandler, notFound } from './http/errors.js';
import { redactUrl, type Logger } from './logger.js';
import { accessRoutes, adminAccessKeyRoutes } from './modules/access-keys/routes.js';
import { agreementTemplateRoutes } from './modules/agreement-templates/routes.js';
import { agreementRoutes } from './modules/agreements/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { companyRoutes } from './modules/companies/routes.js';
import { adminHouseRoutes } from './modules/houses/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { marketRateRoutes } from './modules/market-rates/routes.js';
import { bankOfCanadaSource, type RateSource } from './modules/market-rates/source.js';
import { proposalRoutes } from './modules/proposals/routes.js';
import { referralProgramRoutes } from './modules/referrals/routes.js';
import { taxRateRoutes } from './modules/sales-tax/routes.js';
import { platformTaxPresetRoutes, taxPresetRoutes } from './modules/tax-presets/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { healthRouter } from './routes/health.js';
import { tenantRouter } from './routes/tenant.js';
import { tenantCors } from './tenant/cors.js';
import { createTenantResolver, resolveTenant } from './tenant/resolve-tenant.js';

export interface AppDeps {
  db: Db;
  logger: Logger;
  pingDatabase: () => Promise<void>;
  platformAdminOrigin: string;
  jwtSecret: string;
  now?: () => Date;
  accessKeyRateLimit?: { windowMs: number; max: number };
  signatures?: SignatureProvider;
  rates?: RateSource;
  extend?: (api: express.Router, ctx: ModuleContext) => void;
}

const isHealthProbe = (req: { url?: string }) => req.url === '/api/health';

/** The HTTP API. Health checks need no Origin and are not logged; every other route is bound to the
 * company owning the request's Origin. */
export const createApp = ({
  db,
  logger,
  pingDatabase,
  platformAdminOrigin,
  jwtSecret,
  now = () => new Date(),
  accessKeyRateLimit = { windowMs: 15 * 60 * 1000, max: 20 },
  signatures = builtInSignatureProvider,
  rates = bankOfCanadaSource(),
  extend,
}: AppDeps): Express => {
  const app = express();
  const resolver = createTenantResolver(db, platformAdminOrigin);
  const tokens = createTokenService(jwtSecret);
  const guards = createAuthGuards(tokens);
  const ctx: ModuleContext = {
    db,
    tokens,
    guards,
    resolver,
    now,
    accessKeyRateLimit,
    signatures,
    rates,
  };

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: isHealthProbe },
      serializers: {
        req: (req: { url?: string }) => ({ ...req, url: redactUrl(req.url) }),
      },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use('/api/health', healthRouter({ pingDatabase }));

  app.use(tenantCors(resolver));
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.use(resolveTenant(resolver));
  api.use((req, _res, next) => {
    req.repo = tenantRepo(db, req.tenant.companyId);
    next();
  });
  api.get('/', (_req, res) => {
    res.json({ name: 'homepact-api', version: '0.1.0' } satisfies ApiInfo);
  });
  api.use('/tenant', tenantRouter(db));
  api.use('/auth', authRoutes(ctx));
  api.use('/platform/companies', companyRoutes(ctx));
  api.use('/platform/tax-presets', platformTaxPresetRoutes(ctx));
  api.use('/users', userRoutes(ctx));
  api.use('/catalog', catalogRoutes(ctx));
  api.use('/admin/houses', adminHouseRoutes(ctx));
  api.use('/inventory', inventoryRoutes(ctx));
  api.use('/access', accessRoutes(ctx));
  api.use('/admin/access-keys', adminAccessKeyRoutes(ctx));
  api.use('/proposals', proposalRoutes(ctx));
  api.use('/agreement-templates', agreementTemplateRoutes(ctx));
  api.use('/agreements', agreementRoutes(ctx));
  api.use('/tax-presets', taxPresetRoutes(ctx));
  api.use('/tax-rates', taxRateRoutes(ctx));
  api.use('/referral-programs', referralProgramRoutes(ctx));
  api.use('/market-rates', marketRateRoutes(ctx));
  extend?.(api, ctx);
  app.use('/api', api);

  app.use(() => {
    throw notFound();
  });
  app.use(errorHandler);

  return app;
};
