import { z } from 'zod';

export interface RateObservation {
  date: string;
  ratePercent: number;
}

export interface RateSource {
  readonly name: string;
  seriesUrl(seriesId: string): string;
  /** Observations of a series since a date (YYYY-MM-DD), oldest first. */
  fetchSeries(seriesId: string, since: string): Promise<RateObservation[]>;
}

export const MORTGAGE_RATE_SERIES = 'V80691335';

const VALET = 'https://www.bankofcanada.ca/valet';
const REQUEST_TIMEOUT_MS = 5000;

const valetResponse = z.object({
  observations: z.array(z.looseObject({ d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
});
const valetValue = z.object({ v: z.string().trim().min(1) });

/** The Bank of Canada's Valet API (free, no key). */
export const bankOfCanadaSource = (fetchFn: typeof fetch = fetch): RateSource => ({
  name: 'Bank of Canada',
  seriesUrl: (seriesId) => `${VALET}/series/${seriesId}`,
  async fetchSeries(seriesId, since) {
    const res = await fetchFn(`${VALET}/observations/${seriesId}/json?start_date=${since}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Bank of Canada answered ${res.status} for ${seriesId}`);
    const { observations } = valetResponse.parse(await res.json());
    return observations
      .flatMap((o) => {
        const value = valetValue.safeParse(o[seriesId]);
        const ratePercent = value.success ? Number(value.data.v) : NaN;
        return Number.isFinite(ratePercent) ? [{ date: o.d, ratePercent }] : [];
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  },
});
