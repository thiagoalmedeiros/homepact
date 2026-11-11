import { Router } from 'express';
import type { ModuleContext } from '../../context.js';
import { createMortgageRates } from './store.js';

/** Market rates for the buyer's mortgage estimate; anyone signed in, including invite links. */
export const marketRateRoutes = ({ db, guards, now, rates }: ModuleContext): Router => {
  const router = Router();
  const mortgageRates = createMortgageRates({ db, source: rates, now });
  router.use(guards.requireAuth);

  router.get('/mortgage', async (req, res) => {
    const rate = await mortgageRates.current((err) =>
      req.log.warn({ err }, 'Mortgage reference rate could not be refreshed'),
    );
    res.set('Cache-Control', 'private, max-age=3600').json(rate);
  });

  return router;
};
