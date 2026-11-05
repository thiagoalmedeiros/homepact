import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { healthRouter } from './routes/health.js';

export type AppDeps = {
  pingDatabase: () => Promise<boolean>;
  version: string;
  logger?: Logger;
};

export function createApp({ pingDatabase, version, logger }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  if (logger) app.use(pinoHttp({ logger }));

  app.use('/api', healthRouter({ pingDatabase, version }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
