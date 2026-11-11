import { z } from 'zod';
import { emailSchema } from './auth.js';
import { centsSchema } from './money.js';

export const referralProgramInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  creditCents: centsSchema.min(0),
  active: z.boolean().default(true),
});
export type ReferralProgramInput = z.input<typeof referralProgramInputSchema>;

export interface ReferralProgram {
  id: string;
  name: string;
  description?: string;
  creditCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const referralInputSchema = z.object({
  programId: z.string().min(1),
  referrerName: z.string().trim().min(2).max(120),
  referrerEmail: emailSchema.optional(),
  referrerPhone: z.string().trim().max(40).optional(),
});
export type ReferralInput = z.input<typeof referralInputSchema>;

export interface QuoteReferral {
  programId: string;
  programName: string;
  referrerName: string;
  referrerEmail?: string;
  referrerPhone?: string;
  creditCents: number;
}
