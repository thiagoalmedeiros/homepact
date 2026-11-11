import { z } from 'zod';
import { InventoryStatus } from './enums.js';
import { centsSchema, type Currency } from './money.js';
import { patchSchema } from './schema-utils.js';
import { selectionsSchema, type QuoteSnapshot, type Selections } from './quote.js';

export const inventoryHomeInputSchema = z.object({
  houseId: z.string().min(1),
  address: z.string().trim().min(1).max(160),
  community: z.string().trim().max(80).default(''),
  possession: z.string().trim().max(60).default(''),
  selections: selectionsSchema.default({}),
  priceCents: centsSchema.min(0).optional(),
  features: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  images: z.array(z.url()).default([]),
  lockedByDefault: z.boolean().default(true),
  status: z.enum(InventoryStatus).default(InventoryStatus.Available),
});
export type InventoryHomeInput = z.input<typeof inventoryHomeInputSchema>;
export const inventoryHomeUpdateSchema = patchSchema(inventoryHomeInputSchema);

export interface InventoryHome {
  id: string;
  houseId: string;
  houseName: string;
  address: string;
  community: string;
  possession: string;
  selections: Selections;
  priceCents?: number;
  features: string[];
  images: string[];
  lockedByDefault: boolean;
  status: InventoryStatus;
  quote: QuoteSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface InventorySummary {
  id: string;
  address: string;
  community: string;
  houseName: string;
  totalCents: number;
  currency: Currency;
}
