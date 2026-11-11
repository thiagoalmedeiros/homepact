import type { Proposal } from '@homepact/shared';
import {
  AgreementStatus,
  InventoryStatus,
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
