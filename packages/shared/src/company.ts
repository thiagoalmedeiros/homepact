import { z } from 'zod';
import { VALIDATION } from './messages.js';
import { currencySchema, type Currency } from './money.js';
import { patchSchema } from './schema-utils.js';
import { isValidOrigin, type CompanyContact } from './tenant.js';

export interface Company {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  origins: string[];
  currency: Currency;
  active: boolean;
  tagline?: string;
  heroImageUrl?: string;
  contact?: CompanyContact;
  createdAt: string;
  updatedAt: string;
}

const originSchema = z.string().refine(isValidOrigin, VALIDATION.origin);

export const companyContactSchema = z.object({
  phone: z.string().max(40).optional(),
  email: z.email().optional(),
  address: z.string().max(200).optional(),
  website: z.url().optional(),
});

export const companyInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.slug)
    .max(60),
  logoUrl: z.url(),
  origins: z.array(originSchema).min(1),
  currency: currencySchema.default('CAD'),
  active: z.boolean().default(true),
  tagline: z.string().max(200).optional(),
  heroImageUrl: z.url().optional(),
  contact: companyContactSchema.optional(),
});
export type CompanyInput = z.input<typeof companyInputSchema>;

export const companyUpdateSchema = patchSchema(companyInputSchema);
export type CompanyUpdate = z.input<typeof companyUpdateSchema>;
