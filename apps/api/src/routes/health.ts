import { Router } from 'express';

export type HealthResponse = {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
  version: string;
};

export type HealthDeps = {
  pingDatabase: () => Promise<boolean>;
  version: string;
  uptime?: () => number;
};

export function healthRouter({ pingDatabase, version, uptime = process.uptime }: HealthDeps) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const databaseUp = await pingDatabase().catch(() => false);
    const body: HealthResponse = {
      status: databaseUp ? 'ok' : 'degraded',
      database: databaseUp ? 'up' : 'down',
      uptimeSeconds: Math.floor(uptime()),
      version,
    };
    res.status(databaseUp ? 200 : 503).json(body);
  });

  return router;
}
