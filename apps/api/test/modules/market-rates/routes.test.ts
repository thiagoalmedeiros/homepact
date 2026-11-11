import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { marketRateRoutes } from '../../../src/modules/market-rates/routes.js';
import { createMortgageRates } from '../../../src/modules/market-rates/store.js';
import {
  COMPANY_TENANT,
  keyHolder,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/modules/market-rates/store.js', () => ({ createMortgageRates: vi.fn() }));

const RATE = {
  seriesId: 'V80691335',
  source: 'Bank of Canada',
  sourceUrl: 'https://rates.test',
  ratePercent: 6.09,
  asOf: '2026-11-04',
  history: [],
};
const current = vi.fn();
let h: Harness;
let scene: Scene;

beforeEach(async () => {
  vi.mocked(createMortgageRates).mockReturnValue({ current });
  current.mockResolvedValue(RATE);
  scene = { tenant: COMPANY_TENANT, repo: mockRepo(), principal: keyHolder('proposal-1') };
  h = await serveRouter(marketRateRoutes(mockContext()), scene);
});
afterEach(() => h.close());

it('gives anyone signed in, invite links included, the mortgage reference rate', async () => {
  const res = await h.call('GET', '/mortgage');
  expect(res).toMatchObject({ status: 200, body: RATE });
  expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
  delete scene.principal;
  expect((await h.call('GET', '/mortgage')).status).toBe(401);
});

it('answers null when no rate is known, and logs a failed refresh', async () => {
  current.mockImplementation(async (onError: (err: unknown) => void) => {
    onError(new Error('offline'));
    return null;
  });
  const res = await h.call('GET', '/mortgage');
  expect(res.status).toBe(200);
  expect(res.body).toBeNull();
  expect(h.logWarn).toHaveBeenCalledWith(
    { err: new Error('offline') },
    'Mortgage reference rate could not be refreshed',
  );
});
