import type { Company, TaxPreset } from '@homepact/shared';
import type { Db } from 'mongodb';

export interface CompanyDoc extends Omit<Company, 'id'> {
  _id: string;
}

export interface TaxPresetDoc extends Omit<TaxPreset, 'id'> {
  _id: string;
}

/** Platform-level data: the company registry and the sales tax suggestions, written by the
 * super-admin only. */
export const companiesCollection = (db: Db) => db.collection<CompanyDoc>('companies');

export const taxPresetsCollection = (db: Db) => db.collection<TaxPresetDoc>('taxPresets');

export const findCompany = (db: Db, companyId: string) =>
  companiesCollection(db).findOne({ _id: companyId });

export interface MarketRateDoc {
  _id: string;
  source: string;
  sourceUrl: string;
  observations: { date: string; ratePercent: number }[];
  fetchedAt: string;
}

export const marketRatesCollection = (db: Db) => db.collection<MarketRateDoc>('marketRates');

export const findMarketRate = (db: Db, seriesId: string) =>
  marketRatesCollection(db).findOne({ _id: seriesId });

export const saveMarketRate = async (db: Db, { _id, ...rest }: MarketRateDoc): Promise<void> => {
  await marketRatesCollection(db).updateOne({ _id }, { $set: rest }, { upsert: true });
};

export const listTaxPresets = (db: Db) =>
  taxPresetsCollection(db)
    .find({}, { sort: { name: 1 } })
    .toArray();

export const findTaxPreset = (db: Db, presetId: string) =>
  taxPresetsCollection(db).findOne({ _id: presetId });
