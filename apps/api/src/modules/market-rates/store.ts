import type { MortgageReferenceRate } from '@homepact/shared';
import type { Db } from 'mongodb';
import { findMarketRate, saveMarketRate, type MarketRateDoc } from '../../data/platform-repo.js';
import { MORTGAGE_RATE_SERIES, type RateSource } from './source.js';

const FRESH_FOR_MS = 12 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const HISTORY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (at: Date) => at.toISOString().slice(0, 10);

/** The reference rate and the year of history before its latest observation; null when empty. */
export const toReferenceRate = (doc: MarketRateDoc): MortgageReferenceRate | null => {
  const latest = doc.observations.at(-1);
  if (!latest) return null;
  const since = isoDate(new Date(Date.parse(latest.date) - HISTORY_DAYS * DAY_MS));
  return {
    seriesId: doc._id,
    source: doc.source,
    sourceUrl: doc.sourceUrl,
    ratePercent: latest.ratePercent,
    asOf: latest.date,
    history: doc.observations.filter((o) => o.date >= since),
  };
};

/** Serves the stored rate, refreshed from the source when older than 12 hours. Concurrent
 * requests share one refresh; after a failure the stored rate is served for 10 minutes. */
export const createMortgageRates = ({
  db,
  source,
  now,
}: {
  db: Db;
  source: RateSource;
  now: () => Date;
}) => {
  let refreshing: Promise<MarketRateDoc> | null = null;
  let failedAt = -Infinity;

  const refresh = async (): Promise<MarketRateDoc> => {
    const at = now();
    const since = isoDate(new Date(at.getTime() - (HISTORY_DAYS + 31) * DAY_MS));
    const doc: MarketRateDoc = {
      _id: MORTGAGE_RATE_SERIES,
      source: source.name,
      sourceUrl: source.seriesUrl(MORTGAGE_RATE_SERIES),
      observations: await source.fetchSeries(MORTGAGE_RATE_SERIES, since),
      fetchedAt: at.toISOString(),
    };
    await saveMarketRate(db, doc);
    return doc;
  };

  const current = async (
    onRefreshError: (err: unknown) => void = () => undefined,
  ): Promise<MortgageReferenceRate | null> => {
    const stored = await findMarketRate(db, MORTGAGE_RATE_SERIES);
    const at = now().getTime();
    const fresh = stored && at - Date.parse(stored.fetchedAt) < FRESH_FOR_MS;
    if (fresh || at - failedAt < RETRY_AFTER_FAILURE_MS) return stored && toReferenceRate(stored);
    try {
      refreshing ??= refresh().finally(() => (refreshing = null));
      return toReferenceRate(await refreshing);
    } catch (err) {
      failedAt = at;
      onRefreshError(err);
      return stored && toReferenceRate(stored);
    }
  };

  return { current };
};
