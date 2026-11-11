import type { Db } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findMarketRate,
  saveMarketRate,
  type MarketRateDoc,
} from '../../../src/data/platform-repo.js';
import { MORTGAGE_RATE_SERIES } from '../../../src/modules/market-rates/source.js';
import { createMortgageRates, toReferenceRate } from '../../../src/modules/market-rates/store.js';
import { mockContext } from '../../support/mocks.js';

vi.mock('../../../src/data/platform-repo.js', () => ({
  findMarketRate: vi.fn(),
  saveMarketRate: vi.fn(),
}));

const NOW = new Date('2026-11-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const doc = (over: Partial<MarketRateDoc> = {}): MarketRateDoc => ({
  _id: MORTGAGE_RATE_SERIES,
  source: 'Bank of Canada',
  sourceUrl: 'https://rates.test',
  observations: [
    { date: '2025-10-29', ratePercent: 6.5 },
    { date: '2025-11-05', ratePercent: 6.4 },
    { date: '2026-11-04', ratePercent: 6.09 },
  ],
  fetchedAt: new Date(NOW.getTime() - HOUR).toISOString(),
  ...over,
});
const FETCHED = [{ date: '2026-11-06', ratePercent: 5.99 }];

let now: Date;
let ctx: ReturnType<typeof mockContext>;
let rates: ReturnType<typeof createMortgageRates>;

beforeEach(() => {
  now = NOW;
  ctx = mockContext();
  ctx.rates.fetchSeries = vi.fn().mockResolvedValue(FETCHED);
  rates = createMortgageRates({ db: {} as Db, source: ctx.rates, now: () => now });
});

describe('toReferenceRate', () => {
  it('is the latest observation with the year before it', () => {
    expect(toReferenceRate(doc())).toEqual({
      seriesId: MORTGAGE_RATE_SERIES,
      source: 'Bank of Canada',
      sourceUrl: 'https://rates.test',
      ratePercent: 6.09,
      asOf: '2026-11-04',
      history: [
        { date: '2025-11-05', ratePercent: 6.4 },
        { date: '2026-11-04', ratePercent: 6.09 },
      ],
    });
    expect(toReferenceRate(doc({ observations: [] }))).toBeNull();
  });
});

describe('createMortgageRates', () => {
  it('serves a rate fetched less than 12 hours ago without calling the source', async () => {
    vi.mocked(findMarketRate).mockResolvedValue(doc());
    expect((await rates.current())?.ratePercent).toBe(6.09);
    expect(ctx.rates.fetchSeries).not.toHaveBeenCalled();
  });

  it('refreshes an older rate (13 months of history) and stores it', async () => {
    vi.mocked(findMarketRate).mockResolvedValue(
      doc({ fetchedAt: new Date(NOW.getTime() - 13 * HOUR).toISOString() }),
    );
    expect(await rates.current()).toMatchObject({ ratePercent: 5.99, asOf: '2026-11-06' });
    expect(ctx.rates.fetchSeries).toHaveBeenCalledWith(MORTGAGE_RATE_SERIES, '2025-10-10');
    expect(saveMarketRate).toHaveBeenCalledWith(
      {},
      {
        _id: MORTGAGE_RATE_SERIES,
        source: 'Test rates',
        sourceUrl: 'https://rates.test',
        observations: FETCHED,
        fetchedAt: NOW.toISOString(),
      },
    );
  });

  it('concurrent requests share one refresh', async () => {
    vi.mocked(findMarketRate).mockResolvedValue(null);
    await Promise.all([rates.current(), rates.current(), rates.current()]);
    expect(ctx.rates.fetchSeries).toHaveBeenCalledTimes(1);
  });

  it('when the source fails it serves the stored rate, and waits 10 minutes to retry', async () => {
    const stale = doc({ fetchedAt: new Date(NOW.getTime() - 24 * HOUR).toISOString() });
    vi.mocked(findMarketRate).mockResolvedValue(stale);
    vi.mocked(ctx.rates.fetchSeries).mockRejectedValue(new Error('offline'));
    const onError = vi.fn();
    expect((await rates.current(onError))?.ratePercent).toBe(6.09);
    expect(onError).toHaveBeenCalledWith(new Error('offline'));
    await rates.current(onError);
    expect(ctx.rates.fetchSeries).toHaveBeenCalledTimes(1);
    now = new Date(NOW.getTime() + 11 * 60 * 1000);
    await rates.current(onError);
    expect(ctx.rates.fetchSeries).toHaveBeenCalledTimes(2);
  });

  it('without any stored rate, a failure means no reference rate', async () => {
    vi.mocked(findMarketRate).mockResolvedValue(null);
    vi.mocked(ctx.rates.fetchSeries).mockRejectedValue(new Error('offline'));
    expect(await rates.current()).toBeNull();
  });
});
