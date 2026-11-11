import { beforeEach, describe, expect, it } from 'vitest';
import { carriedTaxRate, resolveTaxRate } from '../../../src/modules/sales-tax/store.js';
import { taxRateDoc } from '../../support/fixtures.js';
import { mockRepo, type MockRepo } from '../../support/mocks.js';

let repo: MockRepo;
const rates = () => repo.col('taxRates');
const ONTARIO = {
  code: 'ON',
  name: 'Ontario',
  components: [{ label: 'HST', ratePercent: 13 }],
};
const NS_QUOTE_TAX = {
  regionCode: 'NS',
  regionName: 'Nova Scotia',
  lines: [{ label: 'HST', ratePercent: 15, amountCents: 7_500_000 }],
  totalCents: 7_500_000,
};

beforeEach(() => {
  repo = mockRepo();
});

describe('resolveTaxRate', () => {
  it('null means no sales tax, without reading anything', async () => {
    expect(await resolveTaxRate(repo, null)).toBeNull();
    expect(repo.of).not.toHaveBeenCalled();
  });

  it("omitted means the company's default province, or none without a default", async () => {
    rates().findOne.mockResolvedValueOnce(taxRateDoc());
    expect(await resolveTaxRate(repo, undefined)).toEqual(ONTARIO);
    expect(rates().findOne).toHaveBeenCalledWith({ isDefault: true });
    expect(await resolveTaxRate(repo, undefined)).toBeNull();
  });

  it("a code is that province of the company, at the company's rate", async () => {
    rates().findOne.mockResolvedValue(taxRateDoc());
    expect(await resolveTaxRate(repo, 'ON')).toEqual(ONTARIO);
    expect(rates().findOne).toHaveBeenCalledWith({ code: 'ON' });
  });

  it('a province the company does not have is a 422', async () => {
    await expect(resolveTaxRate(repo, 'QC')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('no sales tax for QC'),
    });
  });

  it('a province the company removed still prices with the rate the quote had', async () => {
    expect(await resolveTaxRate(repo, 'NS', NS_QUOTE_TAX)).toEqual({
      code: 'NS',
      name: 'Nova Scotia',
      components: [{ label: 'HST', ratePercent: 15 }],
    });
    await expect(resolveTaxRate(repo, 'QC', NS_QUOTE_TAX)).rejects.toMatchObject({ status: 422 });
  });
});

describe('carriedTaxRate', () => {
  it("keeps the quote's province, at the company's current rate", async () => {
    rates().findOne.mockResolvedValue(
      taxRateDoc({
        code: 'NS',
        name: 'Nova Scotia',
        components: [{ label: 'HST', ratePercent: 14 }],
      }),
    );
    expect(await carriedTaxRate(repo, NS_QUOTE_TAX)).toEqual({
      code: 'NS',
      name: 'Nova Scotia',
      components: [{ label: 'HST', ratePercent: 14 }],
    });
    expect(rates().findOne).toHaveBeenCalledWith({ code: 'NS' });
  });

  it('a quote without tax (or from before sales tax existed) stays without tax', async () => {
    expect(await carriedTaxRate(repo, undefined)).toBeNull();
    expect(repo.of).not.toHaveBeenCalled();
  });
});
