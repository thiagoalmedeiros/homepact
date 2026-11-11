import { z } from 'zod';
import type { AgreementSummary } from './agreement.js';
import type { Change as BrowserChange } from './changes.js';
import { emailSchema } from './auth.js';
import {
  ChangeDecision,
  ChangeRequestStatus,
  Party,
  ProposalStatus,
  type ProposalParty,
} from './enums.js';
import { VALIDATION } from './messages.js';
import { slugSchema } from './catalog.js';
import {
  adjustmentSchema,
  selectionsSchema,
  taxRegionSchema,
  type QuoteSnapshot,
  type Selections,
} from './quote.js';
import { referralInputSchema } from './referral.js';

export const contactSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: emailSchema.optional(),
  phone: z.string().trim().max(40).optional(),
});
export type Contact = z.infer<typeof contactSchema>;

export type ProposalKind = 'plan' | 'inventory';

export const changeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('remove_item'), areaSlug: slugSchema, itemId: z.string().min(1) }),
  z.object({ type: z.literal('add_item'), areaSlug: slugSchema, itemId: z.string().min(1) }),
  z.object({ type: z.literal('set_package'), areaSlug: slugSchema, packageId: z.string().min(1) }),
  z.object({ type: z.literal('remove_package'), areaSlug: slugSchema }),
]);
export type Change = z.infer<typeof changeSchema>;
export { applyChanges, ChangeError, diffSelections } from './changes.js';

const zodChangeMatchesBrowserChange: [Change, BrowserChange] extends [BrowserChange, Change]
  ? true
  : never = true;
void zodChangeMatchesBrowserChange;

const proposalPricing = z.object({
  houseId: z.string().min(1).optional(),
  selections: selectionsSchema.default({}),
  inventoryHomeId: z.string().min(1).optional(),
  adjustments: z.array(adjustmentSchema).max(20).default([]),
  taxRegion: taxRegionSchema,
  referral: referralInputSchema.optional(),
});
const planOrHome = <T extends { houseId?: string; inventoryHomeId?: string }>(v: T) =>
  !!v.houseId !== !!v.inventoryHomeId;

export const proposalQuoteSchema = proposalPricing.refine(planOrHome, {
  message: VALIDATION.planOrHome,
  path: ['houseId'],
});
export type ProposalQuoteRequest = z.input<typeof proposalQuoteSchema>;

export const proposalCreateSchema = proposalPricing
  .extend({
    locked: z.boolean().optional(),
    buyer: contactSchema,
    note: z.string().trim().max(4000).optional(),
  })
  .refine(planOrHome, { message: VALIDATION.planOrHome, path: ['houseId'] });
export type ProposalCreate = z.input<typeof proposalCreateSchema>;

export const revisionCreateSchema = z.object({
  selections: selectionsSchema,
  adjustments: z.array(adjustmentSchema).max(20).default([]),
  taxRegion: taxRegionSchema,
  referral: referralInputSchema.nullable().optional(),
  note: z.string().trim().max(4000).optional(),
});
export type RevisionCreate = z.input<typeof revisionCreateSchema>;

export const changeRequestCreateSchema = z.object({
  baseRevision: z.number().int().min(1),
  changes: z.array(changeSchema).min(1).max(30),
  note: z.string().trim().max(4000).optional(),
});
export type ChangeRequestCreate = z.input<typeof changeRequestCreateSchema>;

export const changePreviewSchema = z.object({
  changes: z.array(changeSchema).max(30),
  adjustments: z.array(adjustmentSchema).max(20).optional(),
});

export const decisionSchema = z.object({
  decisions: z
    .array(
      z.object({
        changeId: z.string().min(1),
        approved: z.boolean(),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .min(1),
  adjustments: z.array(adjustmentSchema).max(20).optional(),
  note: z.string().trim().max(4000).optional(),
});
export type DecisionRequest = z.input<typeof decisionSchema>;

export const signSchema = z.object({
  revision: z.number().int().min(1),
  fullName: z.string().trim().min(2).max(120),
  agree: z.literal(true),
});
export type SignRequest = z.input<typeof signSchema>;

export const lockSchema = z.object({ locked: z.boolean() });
export const messageCreateSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const assignRepSchema = z.object({ repId: z.string().min(1) });
export const proposalListQuerySchema = z.object({
  status: z.enum(ProposalStatus).optional(),
  mine: z.enum(['0', '1']).optional(),
});

export interface Revision {
  id: string;
  proposalId: string;
  number: number;
  selections: Selections;
  quote: QuoteSnapshot;
  note?: string;
  authorName: string;
  changeRequestId?: string;
  createdAt: string;
}

export interface RequestedChange {
  id: string;
  change: Change;
  label: string;
  deltaCents: number;
  decision?: ChangeDecision;
  decisionNote?: string;
}

export interface ChangeRequest {
  id: string;
  proposalId: string;
  baseRevision: number;
  changes: RequestedChange[];
  note?: string;
  previewTotalCents: number;
  status: ChangeRequestStatus;
  authorName: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedByName?: string;
  resultRevision?: number;
}

export interface Signature {
  fullName: string;
  revision: number;
  totalCents: number;
  signedAt: string;
}

export interface Proposal {
  id: string;
  reference: string;
  kind: ProposalKind;
  houseId: string;
  houseName: string;
  imageUrl?: string;
  inventoryHomeId?: string;
  address?: string;
  community?: string;
  locked: boolean;
  buyer: Contact;
  buyerUserId?: string;
  repId?: string;
  repName?: string;
  status: ProposalStatus;
  currentRevision: number;
  currentTotalCents: number;
  currency: QuoteSnapshot['currency'];
  openChangeRequestId?: string;
  signature?: Signature;
  accessKeyId?: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalMessage {
  id: string;
  proposalId: string;
  party: Party;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ProposalDetail {
  proposal: Proposal;
  revisions: Revision[];
  changeRequests: ChangeRequest[];
  messages: ProposalMessage[];
  viewerParty: ProposalParty;
  agreement?: AgreementSummary;
}

export interface ProposalCreated {
  proposal: Proposal;
  accessKey: string;
}

export interface ChangePreview {
  quote: QuoteSnapshot;
  changes: { label: string; deltaCents: number }[];
}
