import { z } from 'zod';
import { VALIDATION } from './messages.js';
import { centsSchema } from './money.js';

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.slug)
  .max(60);

export const areaSchema = z.object({
  slug: slugSchema,
  label: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  order: z.number().int().default(0),
});
export type AreaInput = z.input<typeof areaSchema>;
export interface Area {
  slug: string;
  label: string;
  description?: string;
  order: number;
}

export const catalogItemInputSchema = z.object({
  areaSlug: slugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  imageUrl: z.url().optional(),
  priceCents: centsSchema.min(0),
  soldSeparately: z.boolean().default(true),
});
export type CatalogItemInput = z.input<typeof catalogItemInputSchema>;
export interface CatalogItem {
  id: string;
  areaSlug: string;
  name: string;
  description?: string;
  imageUrl?: string;
  priceCents: number;
  soldSeparately?: boolean;
}

export const isSoldSeparately = (item: Pick<CatalogItem, 'soldSeparately'>): boolean =>
  item.soldSeparately !== false;

export const packageInputSchema = z.object({
  areaSlug: slugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  imageUrl: z.url().optional(),
  itemIds: z.array(z.string().min(1)).min(1),
  priceCents: centsSchema.min(0),
});
export type PackageInput = z.input<typeof packageInputSchema>;
export interface Package {
  id: string;
  areaSlug: string;
  name: string;
  description?: string;
  imageUrl?: string;
  itemIds: string[];
  priceCents: number;
}

export interface Catalog {
  areas: Area[];
  items: CatalogItem[];
  packages: Package[];
}
