import { z } from 'zod';
import {
  PaymentAction,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  type AgreementStatus,
  type CompanyRole,
} from './enums.js';
import { centsSchema, type Currency } from './money.js';
import type { PaymentSchedule } from './payment-schedule.js';
import { calendarDateSchema } from './schema-utils.js';

export * from './payment-schedule.js';

const paymentFields = {
  amountCents: centsSchema.min(1).max(10_000_000_000),
  receivedOn: calendarDateSchema,
  method: z.enum(PaymentMethod),
  externalRef: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
  allowDuplicate: z.boolean().default(false),
};

export const paymentCreateSchema = z.object({
  kind: z.enum(PaymentKind).default(PaymentKind.Payment),
  ...paymentFields,
  replacesId: z.string().min(1).optional(),
});
export type PaymentCreate = z.input<typeof paymentCreateSchema>;

export const paymentUpdateSchema = z.object(paymentFields);
export type PaymentUpdate = z.input<typeof paymentUpdateSchema>;

export const paymentReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type PaymentReason = z.input<typeof paymentReasonSchema>;

export const paymentQueueQuerySchema = z.object({
  status: z.enum(PaymentStatus).default(PaymentStatus.Pending),
  agreementId: z.string().min(1).optional(),
});

export interface PaymentActor {
  id: string;
  name: string;
  role: CompanyRole;
}

export interface PaymentEvent {
  at: string;
  by: PaymentActor;
  action: PaymentAction;
  reason?: string;
}

export interface AgreementPayment {
  id: string;
  reference: string;
  agreementId: string;
  agreementReference: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amountCents: number;
  currency: Currency;
  receivedOn: string;
  method: PaymentMethod;
  externalRef?: string;
  note?: string;
  recordedBy: PaymentActor;
  recordedAt: string;
  reviewedBy?: PaymentActor;
  reviewedAt?: string;
  rejectReason?: string;
  voidedBy?: PaymentActor;
  voidedAt?: string;
  voidReason?: string;
  replacesId?: string;
  replacedById?: string;
  history: PaymentEvent[];
  updatedAt: string;
}

export interface BuyerPayment {
  id: string;
  reference: string;
  kind: PaymentKind;
  amountCents: number;
  currency: Currency;
  receivedOn: string;
  method: PaymentMethod;
}

export interface AgreementLedger {
  agreementId: string;
  agreementReference: string;
  agreementStatus: AgreementStatus;
  currency: Currency;
  schedule: PaymentSchedule;
  payments: AgreementPayment[];
}

export interface BuyerLedger {
  agreementId: string;
  agreementReference: string;
  currency: Currency;
  schedule: PaymentSchedule;
  payments: BuyerPayment[];
}
