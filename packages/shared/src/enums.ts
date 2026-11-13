export enum Role {
  SuperAdmin = 'super_admin',
  CompanyAdmin = 'company_admin',
  CompanyStaff = 'company_staff',
  CompanyFinance = 'company_finance',
  Buyer = 'buyer',
}

export enum GuestRole {
  KeyHolder = 'key_holder',
}

export type PrincipalRole = Role | GuestRole;

export const STAFF_ROLES = [Role.CompanyAdmin, Role.CompanyStaff] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const isStaffRole = (role: PrincipalRole | null | undefined): role is StaffRole =>
  role === Role.CompanyAdmin || role === Role.CompanyStaff;

export const COMPANY_ROLES = [Role.CompanyAdmin, Role.CompanyStaff, Role.CompanyFinance] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const isCompanyRole = (role: PrincipalRole | null | undefined): role is CompanyRole =>
  (COMPANY_ROLES as readonly (PrincipalRole | null | undefined)[]).includes(role);

export const PAYMENT_MANAGER_ROLES = [Role.CompanyFinance, Role.CompanyAdmin] as const;

export const isPaymentManager = (role: PrincipalRole | null | undefined): boolean =>
  (PAYMENT_MANAGER_ROLES as readonly (PrincipalRole | null | undefined)[]).includes(role);

export enum Party {
  Buyer = 'buyer',
  Seller = 'seller',
  System = 'system',
}

export type ProposalParty = Party.Buyer | Party.Seller;

export enum ProposalStatus {
  Proposed = 'proposed',
  ChangesRequested = 'changes_requested',
  Signed = 'signed',
  Declined = 'declined',
  Withdrawn = 'withdrawn',
}

export const ACTIVE_PROPOSAL_STATUSES = [
  ProposalStatus.Proposed,
  ProposalStatus.ChangesRequested,
] as const;

export const isActiveProposal = (status: ProposalStatus): boolean =>
  (ACTIVE_PROPOSAL_STATUSES as readonly ProposalStatus[]).includes(status);

export enum ChangeRequestStatus {
  Open = 'open',
  Resolved = 'resolved',
  Withdrawn = 'withdrawn',
}

export enum ChangeDecision {
  Approved = 'approved',
  Declined = 'declined',
}

export enum HouseStatus {
  Draft = 'draft',
  Published = 'published',
}

export enum InventoryStatus {
  Available = 'available',
  Reserved = 'reserved',
  Sold = 'sold',
}

export enum AgreementStatus {
  Draft = 'draft',
  UnderReview = 'under_review',
  Signed = 'signed',
  Executed = 'executed',
  Cancelled = 'cancelled',
}

export const OPEN_AGREEMENT_STATUSES = [
  AgreementStatus.Draft,
  AgreementStatus.UnderReview,
  AgreementStatus.Signed,
] as const;

export const isOpenAgreement = (status: AgreementStatus): boolean =>
  (OPEN_AGREEMENT_STATUSES as readonly AgreementStatus[]).includes(status);

export const PAYABLE_AGREEMENT_STATUSES = [
  AgreementStatus.Signed,
  AgreementStatus.Executed,
] as const;

export const isPayableAgreement = (status: AgreementStatus): boolean =>
  (PAYABLE_AGREEMENT_STATUSES as readonly AgreementStatus[]).includes(status);

export const REFUNDABLE_AGREEMENT_STATUSES = [
  ...PAYABLE_AGREEMENT_STATUSES,
  AgreementStatus.Cancelled,
] as const;

export const isRefundableAgreement = (status: AgreementStatus): boolean =>
  (REFUNDABLE_AGREEMENT_STATUSES as readonly AgreementStatus[]).includes(status);

export enum SignerStatus {
  Pending = 'pending',
  Signed = 'signed',
  Invalidated = 'invalidated',
}

export enum AccessKeyStatus {
  Active = 'active',
  Revoked = 'revoked',
  Claimed = 'claimed',
}

export enum AccessResourceType {
  Proposal = 'proposal',
  Agreement = 'agreement',
}

export enum HealthStatus {
  Ok = 'ok',
  Degraded = 'degraded',
}

export enum ServiceState {
  Up = 'up',
  Down = 'down',
}

export enum PaymentKind {
  Payment = 'payment',
  Refund = 'refund',
}

export enum PaymentStatus {
  Pending = 'pending',
  Posted = 'posted',
  Rejected = 'rejected',
  Withdrawn = 'withdrawn',
  Voided = 'voided',
}

export enum PaymentMethod {
  Cheque = 'cheque',
  BankDraft = 'bank_draft',
  Wire = 'wire',
  Eft = 'eft',
  Card = 'card',
  Cash = 'cash',
  Other = 'other',
}

export enum PaymentAction {
  Recorded = 'recorded',
  Edited = 'edited',
  Approved = 'approved',
  Rejected = 'rejected',
  Withdrawn = 'withdrawn',
  Voided = 'voided',
}

export enum InstalmentStatus {
  Paid = 'paid',
  Partial = 'partial',
  Overdue = 'overdue',
  Due = 'due',
  Upcoming = 'upcoming',
}
