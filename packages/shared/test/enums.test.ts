import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PROPOSAL_STATUSES,
  AccessKeyStatus,
  AccessResourceType,
  AgreementStatus,
  OPEN_AGREEMENT_STATUSES,
  SignerStatus,
  ChangeDecision,
  ChangeRequestStatus,
  GuestRole,
  HealthStatus,
  HouseStatus,
  InventoryStatus,
  isActiveProposal,
  isOpenAgreement,
  isStaffRole,
  Party,
  ProposalStatus,
  Role,
  ServiceState,
  STAFF_ROLES,
} from '../src/enums.js';

describe('enums', () => {
  it('keep the values that are stored and sent', () => {
    expect(Object.values(Role)).toEqual(['super_admin', 'company_admin', 'company_staff', 'buyer']);
    expect(Object.values(GuestRole)).toEqual(['key_holder']);
    expect(Object.values(Party)).toEqual(['buyer', 'seller', 'system']);
    expect(Object.values(ProposalStatus)).toEqual([
      'proposed',
      'changes_requested',
      'signed',
      'declined',
      'withdrawn',
    ]);
    expect(Object.values(ChangeRequestStatus)).toEqual(['open', 'resolved', 'withdrawn']);
    expect(Object.values(ChangeDecision)).toEqual(['approved', 'declined']);
    expect(Object.values(HouseStatus)).toEqual(['draft', 'published']);
    expect(Object.values(InventoryStatus)).toEqual(['available', 'reserved', 'sold']);
    expect(Object.values(AgreementStatus)).toEqual([
      'draft',
      'under_review',
      'signed',
      'executed',
      'cancelled',
    ]);
    expect(Object.values(SignerStatus)).toEqual(['pending', 'signed', 'invalidated']);
    expect(Object.values(AccessKeyStatus)).toEqual(['active', 'revoked', 'claimed']);
    expect(Object.values(AccessResourceType)).toEqual(['proposal', 'agreement']);
    expect(Object.values(HealthStatus)).toEqual(['ok', 'degraded']);
    expect(Object.values(ServiceState)).toEqual(['up', 'down']);
  });

  it('an agreement is open until it is executed or cancelled', () => {
    expect(OPEN_AGREEMENT_STATUSES).toEqual([
      AgreementStatus.Draft,
      AgreementStatus.UnderReview,
      AgreementStatus.Signed,
    ]);
    expect(isOpenAgreement(AgreementStatus.UnderReview)).toBe(true);
    expect(isOpenAgreement(AgreementStatus.Executed)).toBe(false);
    expect(isOpenAgreement(AgreementStatus.Cancelled)).toBe(false);
  });

  it('staff are company administrators and sales staff', () => {
    expect(STAFF_ROLES).toEqual([Role.CompanyAdmin, Role.CompanyStaff]);
    expect(isStaffRole(Role.CompanyAdmin)).toBe(true);
    expect(isStaffRole(Role.CompanyStaff)).toBe(true);
    for (const other of [Role.Buyer, Role.SuperAdmin, GuestRole.KeyHolder, undefined, null]) {
      expect(isStaffRole(other), String(other)).toBe(false);
    }
  });

  it('a proposal is active while it is being negotiated', () => {
    expect(ACTIVE_PROPOSAL_STATUSES).toEqual([
      ProposalStatus.Proposed,
      ProposalStatus.ChangesRequested,
    ]);
    expect(Object.values(ProposalStatus).filter(isActiveProposal)).toEqual([
      ...ACTIVE_PROPOSAL_STATUSES,
    ]);
  });
});
