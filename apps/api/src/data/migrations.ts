import type { Db } from 'mongodb';

interface LegacyOffer {
  packages?: { packageId: string; priceCents?: number }[];
  items?: { itemId: string; priceCents?: number }[];
}

/** Idempotent migrations run at boot. 2026-10-31: per-plan `offers` become `priceOverrides`. */
export const runMigrations = async (db: Db): Promise<void> => {
  const houses = db.collection<{ _id: string; offers?: LegacyOffer[] }>('houses');
  for (const house of await houses.find({ offers: { $exists: true } }).toArray()) {
    const priceOverrides = (house.offers ?? []).flatMap((o) => [
      ...(o.packages ?? []).flatMap((p) =>
        p.priceCents === undefined ? [] : [{ refId: p.packageId, priceCents: p.priceCents }],
      ),
      ...(o.items ?? []).flatMap((i) =>
        i.priceCents === undefined ? [] : [{ refId: i.itemId, priceCents: i.priceCents }],
      ),
    ]);
    await houses.updateOne(
      { _id: house._id },
      { $set: { priceOverrides }, $unset: { offers: '' } },
    );
  }
};
