import type { Proposal } from '@homepact/shared';
import {
  AgreementStatus,
  InstalmentStatus,
  InventoryStatus,
  PaymentMethod,
  PaymentStatus,
  Party,
  ProposalStatus,
  type ProposalParty,
} from '@homepact/shared/enums';

export interface Label {
  text: string;
  tone: string;
}

export const PROPOSAL_LABEL: Record<ProposalStatus, Label> = {
  [ProposalStatus.Proposed]: {
    text: $localize`:@@status.proposal.proposed:With buyer`,
    tone: 'blue',
  },
  [ProposalStatus.ChangesRequested]: {
    text: $localize`:@@status.proposal.changes_requested:Changes requested`,
    tone: 'orange',
  },
  [ProposalStatus.Signed]: { text: $localize`:@@status.proposal.signed:Signed`, tone: 'green' },
  [ProposalStatus.Declined]: { text: $localize`:@@status.proposal.declined:Declined`, tone: '' },
  [ProposalStatus.Withdrawn]: { text: $localize`:@@status.proposal.withdrawn:Withdrawn`, tone: '' },
};

export const INVENTORY_LABEL: Record<InventoryStatus, Label> = {
  [InventoryStatus.Available]: {
    text: $localize`:@@status.inventory.available:Available`,
    tone: 'green',
  },
  [InventoryStatus.Reserved]: {
    text: $localize`:@@status.inventory.reserved:Reserved`,
    tone: 'orange',
  },
  [InventoryStatus.Sold]: { text: $localize`:@@status.inventory.sold:Sold`, tone: '' },
};

export const AGREEMENT_LABEL: Record<AgreementStatus, Label> = {
  [AgreementStatus.Draft]: { text: $localize`:@@status.agreement.draft:Draft`, tone: 'orange' },
  [AgreementStatus.UnderReview]: {
    text: $localize`:@@status.agreement.under_review:Out for signature`,
    tone: 'blue',
  },
  [AgreementStatus.Signed]: {
    text: $localize`:@@status.agreement.signed:To countersign`,
    tone: 'orange',
  },
  [AgreementStatus.Executed]: {
    text: $localize`:@@status.agreement.executed:Executed`,
    tone: 'green',
  },
  [AgreementStatus.Cancelled]: {
    text: $localize`:@@status.agreement.cancelled:Cancelled`,
    tone: '',
  },
};

export const PAYMENT_LABEL: Record<PaymentStatus, Label> = {
  [PaymentStatus.Pending]: {
    text: $localize`:@@status.payment.pending:Waiting for approval`,
    tone: 'orange',
  },
  [PaymentStatus.Posted]: { text: $localize`:@@status.payment.posted:Received`, tone: 'green' },
  [PaymentStatus.Rejected]: { text: $localize`:@@status.payment.rejected:Rejected`, tone: '' },
  [PaymentStatus.Withdrawn]: {
    text: $localize`:@@status.payment.withdrawn:Withdrawn`,
    tone: '',
  },
  [PaymentStatus.Voided]: { text: $localize`:@@status.payment.voided:Voided`, tone: '' },
};

export const INSTALMENT_LABEL: Record<InstalmentStatus, Label> = {
  [InstalmentStatus.Paid]: { text: $localize`:@@status.instalment.paid:Paid`, tone: 'green' },
  [InstalmentStatus.Partial]: {
    text: $localize`:@@status.instalment.partial:Partly paid`,
    tone: 'blue',
  },
  [InstalmentStatus.Overdue]: {
    text: $localize`:@@status.instalment.overdue:Overdue`,
    tone: 'orange',
  },
  [InstalmentStatus.Due]: { text: $localize`:@@status.instalment.due:Due`, tone: 'blue' },
  [InstalmentStatus.Upcoming]: {
    text: $localize`:@@status.instalment.upcoming:Upcoming`,
    tone: '',
  },
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  [PaymentMethod.Cheque]: $localize`:@@payment.method.cheque:Cheque`,
  [PaymentMethod.BankDraft]: $localize`:@@payment.method.bank_draft:Bank draft`,
  [PaymentMethod.Wire]: $localize`:@@payment.method.wire:Wire transfer`,
  [PaymentMethod.Eft]: $localize`:@@payment.method.eft:Electronic transfer`,
  [PaymentMethod.Card]: $localize`:@@payment.method.card:Card`,
  [PaymentMethod.Cash]: $localize`:@@payment.method.cash:Cash`,
  [PaymentMethod.Other]: $localize`:@@payment.method.other:Other`,
};

/** Whose move it is, phrased for the person looking at the proposal. */
export const turnOf = (p: Proposal, viewer: ProposalParty): Label => {
  switch (p.status) {
    case ProposalStatus.Proposed:
      return viewer === Party.Buyer
        ? { text: $localize`:@@status.turn.buyerToReview:Ready for you to review`, tone: 'blue' }
        : { text: $localize`:@@status.turn.sellerWaiting:Waiting for the buyer`, tone: 'blue' };
    case ProposalStatus.ChangesRequested:
      return viewer === Party.Seller
        ? { text: $localize`:@@status.turn.sellerToReview:Needs your review`, tone: 'orange' }
        : p.repName
          ? {
              text: $localize`:@@status.turn.buyerWaitingFor:Waiting for ${p.repName.split(' ')[0]}:name: to review your changes`,
              tone: 'orange',
            }
          : {
              text: $localize`:@@status.turn.buyerWaitingForSeller:Waiting for the seller to review your changes`,
              tone: 'orange',
            };
    default:
      return PROPOSAL_LABEL[p.status];
  }
};
