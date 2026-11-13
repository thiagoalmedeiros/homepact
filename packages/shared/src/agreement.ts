import { z } from 'zod';
import { unknownFields, type AgreementSectionText } from './agreement-fields.js';
import { emailSchema } from './auth.js';
import { AgreementStatus, SignerStatus } from './enums.js';
import type { HouseSpecs } from './house.js';
import { centsSchema, type Currency } from './money.js';
import { VALIDATION } from './messages.js';
import { calendarDateSchema } from './schema-utils.js';
import type { AgreementPaymentSummary } from './payment-schedule.js';
import type { ProposalKind, Signature } from './proposal.js';
import type { QuoteSnapshot } from './quote.js';

export * from './agreement-fields.js';

/** Merge fields may appear anywhere; a typo in one is caught when the template is saved. */
const mergeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .superRefine((text, ctx) => {
      for (const key of unknownFields(text)) {
        ctx.addIssue({ code: 'custom', message: VALIDATION.unknownField(key) });
      }
    });

export const agreementSectionSchema = z.object({
  heading: mergeText(120),
  body: mergeText(8000),
  requiresInitials: z.boolean().default(false),
});
export type AgreementSection = AgreementSectionText;

export const agreementTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  title: mergeText(160),
  sections: z.array(agreementSectionSchema).min(1).max(40),
  isDefault: z.boolean().default(false),
});
export type AgreementTemplateInput = z.input<typeof agreementTemplateInputSchema>;

export interface AgreementTemplate {
  id: string;
  name: string;
  title: string;
  sections: AgreementSection[];
  isDefault: boolean;
  version: number;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
}

export const purchaserInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema.optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(200).optional(),
});

export const depositInstalmentSchema = z.object({
  label: z.string().trim().min(1).max(80),
  amountCents: centsSchema.min(1),
  dueDate: calendarDateSchema.optional(),
});
export type DepositInstalment = z.output<typeof depositInstalmentSchema>;

export const agreementConditionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  details: z.string().trim().max(500).optional(),
  dueDate: calendarDateSchema.optional(),
});
export type AgreementCondition = z.output<typeof agreementConditionSchema>;

export const agreementTermsSchema = z.object({
  deposits: z.array(depositInstalmentSchema).min(1).max(8),
  conditions: z.array(agreementConditionSchema).max(10).default([]),
  closingDate: calendarDateSchema.optional(),
  specialTerms: z.string().trim().max(4000).optional(),
});
export type AgreementTermsInput = z.output<typeof agreementTermsSchema>;

export interface AgreementTerms extends AgreementTermsInput {
  depositCents: number;
}

export const agreementCreateSchema = agreementTermsSchema.extend({
  proposalId: z.string().min(1),
  templateId: z.string().min(1),
  purchasers: z.array(purchaserInputSchema).min(1).max(6),
});
export type AgreementCreate = z.input<typeof agreementCreateSchema>;

export const agreementUpdateSchema = agreementTermsSchema.extend({
  templateId: z.string().min(1),
  purchasers: z.array(purchaserInputSchema).min(1).max(6),
});
export type AgreementUpdate = z.input<typeof agreementUpdateSchema>;
export type AgreementPreparation = z.output<typeof agreementUpdateSchema>;

const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/, VALIDATION.contentHash);

export const agreementIssueSchema = z.object({ contentHash: contentHashSchema });
export type AgreementIssue = z.input<typeof agreementIssueSchema>;

export const agreementSignSchema = z.object({
  contentHash: contentHashSchema,
  fullName: z.string().trim().min(2).max(120),
  initials: z.array(z.number().int().min(1).max(40)).max(40).default([]),
  agree: z.literal(true),
});
export type AgreementSign = z.input<typeof agreementSignSchema>;

export const agreementCountersignSchema = z.object({
  contentHash: contentHashSchema,
  fullName: z.string().trim().min(2).max(120),
  agree: z.literal(true),
});
export type AgreementCountersign = z.input<typeof agreementCountersignSchema>;

export const agreementCancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type AgreementCancel = z.input<typeof agreementCancelSchema>;

export const agreementListQuerySchema = z.object({
  status: z.enum(AgreementStatus).optional(),
  proposalId: z.string().min(1).optional(),
});

export interface AgreementParty {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface AgreementHome {
  kind: ProposalKind;
  model: string;
  address?: string;
  community?: string;
  specs?: HouseSpecs;
}

export interface AgreementSignature {
  fullName: string;
  signedAt: string;
  contentHash: string;
  ip?: string;
  provider: string;
  initials?: number[];
}

export interface AgreementPurchaser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  status: SignerStatus;
  invitedAt?: string;
  signature?: AgreementSignature;
  invalidatedAt?: string;
}

export interface SignerInvitation {
  purchaserId: string;
  name: string;
  email?: string;
  key: string;
  code: string;
}

export interface Agreement {
  id: string;
  reference: string;
  status: AgreementStatus;
  proposalId: string;
  proposalReference: string;
  template: { id: string; name: string; version: number };
  title: string;
  sections: AgreementSection[];
  seller: AgreementParty;
  buyer: AgreementParty;
  purchasers: AgreementPurchaser[];
  home: AgreementHome;
  quote: QuoteSnapshot;
  proposalSignature: Signature;
  terms: AgreementTerms;
  currency: Currency;
  repName?: string;
  preparedAt: string;
  contentHash: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  issuedAt?: string;
  issuedByName?: string;
  signedAt?: string;
  counterSignature?: AgreementSignature;
  executedAt?: string;
  cancelledAt?: string;
  cancelledByName?: string;
  cancelReason?: string;
  executedPdf?: { sha256: string; size: number };
  viewerPurchaserId?: string;
}

export interface AgreementIssued {
  agreement: Agreement;
  invitations: SignerInvitation[];
}

export interface AgreementSummary {
  id: string;
  reference: string;
  status: AgreementStatus;
  proposalId: string;
  proposalReference: string;
  buyerName: string;
  houseName: string;
  address?: string;
  totalCents: number;
  currency: Currency;
  createdAt: string;
  updatedAt: string;
  issuedAt?: string;
  signedAt?: string;
  executedAt?: string;
  signedCount: number;
  purchaserCount: number;
  payments?: AgreementPaymentSummary;
}
