import { describe, expect, it, vi } from 'vitest';
import {
  bankOfCanadaSource,
  MORTGAGE_RATE_SERIES,
} from '../../../src/modules/market-rates/source.js';

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('bankOfCanadaSource', () => {
  it('reads a Valet series since a date, oldest first, skipping missing values', async () => {
    const fetchFn = reply({
      seriesDetail: {},
      observations: [
        { d: '2026-10-28', [MORTGAGE_RATE_SERIES]: { v: '6.09' } },
        { d: '2026-10-21', [MORTGAGE_RATE_SERIES]: { v: '6.14' } },
        { d: '2026-10-14', [MORTGAGE_RATE_SERIES]: { v: '' } },
        { d: '2026-10-07' },
      ],
    });
    const source = bankOfCanadaSource(fetchFn);
    expect(await source.fetchSeries(MORTGAGE_RATE_SERIES, '2025-09-01')).toEqual([
      { date: '2026-10-21', ratePercent: 6.14 },
      { date: '2026-10-28', ratePercent: 6.09 },
    ]);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(url).toBe(
      `https://www.bankofcanada.ca/valet/observations/${MORTGAGE_RATE_SERIES}/json?start_date=2025-09-01`,
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(source.name).toBe('Bank of Canada');
    expect(source.seriesUrl(MORTGAGE_RATE_SERIES)).toBe(
      `https://www.bankofcanada.ca/valet/series/${MORTGAGE_RATE_SERIES}`,
    );
  });

  it('fails on an error status or an unexpected body', async () => {
    await expect(
      bankOfCanadaSource(reply({}, 503)).fetchSeries(MORTGAGE_RATE_SERIES, '2025-09-01'),
    ).rejects.toThrow('Bank of Canada answered 503');
    await expect(
      bankOfCanadaSource(reply({ observations: [{ d: 'yesterday' }] })).fetchSeries(
        MORTGAGE_RATE_SERIES,
        '2025-09-01',
      ),
    ).rejects.toThrow();
  });
});
