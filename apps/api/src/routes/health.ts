import { HealthStatus, ServiceState, type HealthResponse } from '@homepact/shared';
import { Router } from 'express';

export const healthRouter = ({ pingDatabase }: { pingDatabase: () => Promise<void> }): Router => {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      await pingDatabase();
      res.json({ status: HealthStatus.Ok, database: ServiceState.Up } satisfies HealthResponse);
    } catch {
      res.status(503).json({
        status: HealthStatus.Degraded,
        database: ServiceState.Down,
      } satisfies HealthResponse);
    }
  });

  return router;
};
