import cors from 'cors';
import type { RequestHandler } from 'express';
import type { TenantResolver } from './resolve-tenant.js';

/** CORS only admits registered company origins and the platform admin origin. */
export const tenantCors = (resolver: TenantResolver): RequestHandler =>
  cors({
    origin: (origin, callback) => {
      resolver.resolve(origin).then(
        (tenant) => callback(null, tenant ? (origin as string) : false),
        (err: Error) => callback(err),
      );
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
