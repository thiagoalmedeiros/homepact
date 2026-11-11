import { z } from 'zod';
import { slugSchema } from './catalog.js';
import { patchSchema } from './schema-utils.js';
import type { HouseStatus } from './enums.js';
import { centsSchema, type Currency } from './money.js';

export const priceOverrideSchema = z.object({
  refId: z.string().min(1),
  priceCents: centsSchema.min(0),
});
export type PriceOverride = z.output<typeof priceOverrideSchema>;

export const houseSpecsSchema = z.object({
  sqft: z.number().int().min(0),
  beds: z.number().min(0),
  baths: z.number().min(0),
  garage: z.number().int().min(0).default(0),
  storeys: z.number().int().min(1).optional(),
});
export type HouseSpecs = z.output<typeof houseSpecsSchema>;

export const houseInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  style: z.string().trim().max(60).default(''),
  headline: z.string().max(160).optional(),
  description: z.string().max(4000).default(''),
  communities: z.array(z.string().trim().min(1).max(80)).default([]),
  specs: houseSpecsSchema,
  images: z.array(z.url()).default([]),
  floorPlanImages: z.array(z.url()).default([]),
  basePriceCents: centsSchema.min(0),
  priceOverrides: z.array(priceOverrideSchema).max(500).default([]),
});
export type HouseInput = z.input<typeof houseInputSchema>;
export const houseUpdateSchema = patchSchema(houseInputSchema);

export interface House {
  id: string;
  name: string;
  slug: string;
  style: string;
  headline?: string;
  description: string;
  communities: string[];
  specs: HouseSpecs;
  images: string[];
  floorPlanImages: string[];
  basePriceCents: number;
  priceOverrides: PriceOverride[];
  status: HouseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HouseSummary {
  id: string;
  name: string;
  slug: string;
  style: string;
  headline?: string;
  communities: string[];
  specs: HouseSpecs;
  imageUrl?: string;
  basePriceCents: number;
  currency: Currency;
}

export interface ConfiguratorOption {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  priceCents: number;
  catalogPriceCents?: number;
}
export interface ConfiguratorItem extends ConfiguratorOption {
  soldSeparately: boolean;
}
export interface ConfiguratorPackage extends ConfiguratorOption {
  itemIds: string[];
  itemNames: string[];
}
export interface ConfiguratorArea {
  slug: string;
  label: string;
  description?: string;
  packages: ConfiguratorPackage[];
  items: ConfiguratorItem[];
}
export interface HouseDetail {
  house: Omit<House, 'priceOverrides'>;
  currency: Currency;
  areas: ConfiguratorArea[];
}
