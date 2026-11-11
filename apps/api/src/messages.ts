const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const ERRORS = {
  http: {
    invalidRequest: 'Invalid request',
    authenticationRequired: 'Authentication required',
    forbidden: 'Forbidden',
    notFound: 'Not found',
    malformedJson: 'Malformed JSON body',
    internal: 'Internal server error',
  },
  tenant: {
    unknownOrigin: 'Unknown origin',
    notOnThisOrigin: 'Not available on this origin',
  },
  auth: {
    tokenWrongOrigin: 'Token not valid for this origin',
    invalidToken: 'Invalid or expired token',
    insufficientRole: 'Insufficient role',
    registrationCompanyOnly: 'Registration is only open on company sites',
    emailTaken: 'An account with this email already exists',
    badCredentials: 'Incorrect email or password',
    invalidRefreshToken: 'Invalid refresh token',
    refreshTokenReuse: 'Refresh token reuse detected',
  },
  accessKeys: {
    invalidKey: 'Invalid or revoked access key',
    keyWrongOrigin: 'Key not valid for this origin',
    keyAlreadyUsed: 'Key was already used',
    tooManyAttempts: 'Too many attempts, try again later',
    codeRequired: 'This link needs the code that was sent to you',
    onlyProposalKeys: 'This link cannot be added to an account',
  },
  companies: {
    originOrSlugTaken: 'Origin or slug already belongs to a company',
  },
  users: {
    cannotDemoteSelf: 'You cannot deactivate or demote yourself',
  },
  catalog: {
    unknownArea: (slug: string) => `Unknown area "${slug}"`,
    packageItemsOutsideArea: 'Package items must belong to the package area',
    usedByInventory: 'A pre-existing home is built with this option',
    areaSlugTaken: 'An area with this slug already exists',
    areaInUse: 'Remove the items and packages of this area first',
    itemInPackage: 'Item is part of a package; remove it from the package first',
  },
  houses: {
    notFound: 'House not found',
    slugTaken: 'A house with this slug already exists',
    inUse: 'This model is used by proposals or homes',
    onlyDraftsDeletable: 'Only existing draft houses can be deleted',
    optionNotInCatalog: (refId: string) => `Option ${refId} is not in the catalog`,
  },
  inventory: {
    hasProposals: 'This home has proposals; mark it sold or reserved instead',
  },
  proposals: {
    notFound: 'Proposal not found',
    revisionNotFound: 'Revision not found',
    homeNotFound: 'Pre-existing home not found',
    homeSold: 'This home is already sold',
    onlyHomesLock: 'Only pre-existing homes can be locked',
    answerRequestFirst: 'Respond to the buyer’s change request first',
    answerOpenRequestFirst: 'Respond to the open change request first',
    closed: 'This proposal is closed',
    changedReload: 'The proposal changed meanwhile; reload and try again',
    changedBeforeSigning: 'The proposal changed meanwhile; review it before signing',
    repNotFound: 'Sales rep not found in this company',
    offeredAsIs: 'This home is offered as-is',
    offeredAsIsNoChanges: 'This home is offered as-is; changes cannot be requested',
    requestAlreadyOpen: 'You already have a change request waiting for the seller',
    newerRevision: 'A newer revision is available; review it first',
    newerRevisionBeforeSigning: 'A newer revision is available; review it before signing',
    noOpenRequest: 'There is no open change request to withdraw',
    requestNotFound: 'Change request not found',
    requestAnswered: 'This change request was already answered',
    decideEveryChange: 'Approve or decline every requested change',
    withdrawOrWait: 'Withdraw your change request or wait for the seller first',
    agreementExecuted: 'The purchase agreement is executed; this sale can no longer be re-priced',
  },
  agreements: {
    onlySignedProposals: 'Only a signed proposal can become a purchase agreement',
    chooseTemplate: 'Choose one of your agreement templates',
    signedRevisionNotFound: 'The signed revision was not found',
    depositAbovePrice: 'The deposit cannot be more than the purchase price',
    proposalHasAgreement: 'This proposal already has a purchase agreement',
    homeSold: 'This home is already sold',
    onlyOpenEditable: 'An executed or cancelled agreement can no longer be changed',
    changedReload: 'The agreement changed meanwhile; reload it',
    alreadySent: 'This agreement was already sent',
    changedBeforeSending: 'The agreement changed; review it again before sending',
    alreadySigned: 'You already signed this agreement',
    notOpenForSignature: 'This agreement is not open for signature',
    changedBeforeSigning: 'The agreement changed; review it again before signing',
    changedMeanwhileBeforeSigning:
      'The agreement changed meanwhile; review it again before signing',
    initialsRequired: 'Initial every key clause before signing',
    notASigner: 'Open your own signing link to sign this agreement',
    purchaserNotFound: 'Purchaser not found on this agreement',
    notIssued: 'Send the agreement for signature first',
    waitingForPurchasers: 'Every purchaser must sign before you can countersign',
    alreadyExecuted: 'This agreement is already executed',
    executedCannotCancel: 'An executed agreement cannot be cancelled',
    alreadyCancelled: 'This agreement is already cancelled',
    priceChanged: 'The price of the signed proposal changed; this agreement is void',
  },
  templates: {
    nameTaken: 'A template with this name already exists',
  },
  taxes: {
    unknownRegion: (code: string) =>
      `Your company has no sales tax for ${code}; add it under Sales tax & referrals first`,
    regionTaken: (code: string) => `Your company already has a sales tax for ${code}`,
    presetNotFound: 'This sales tax suggestion no longer exists',
  },
  referrals: {
    unknownProgram: 'This referral program does not exist or is no longer active',
  },
} as const;

export const NAMES = {
  system: 'System',
  buyer: 'Buyer',
  guest: 'Guest',
  platform: 'Homepact Platform',
} as const;

export const THREAD = {
  proposed: (rep: string, house: string, address: string | undefined, total: string) =>
    `${rep} proposed ${house}${address ? ` at ${address}` : ''}: revision 1, ${total}.`,
  revisionSent: (rep: string, revision: number, total: string) =>
    `${rep} sent revision ${revision}: ${total}.`,
  locked: 'This home is now offered as-is: changes can no longer be requested.',
  unlocked: 'Changes can now be requested for this home.',
  repAssigned: (rep: string) => `${rep} is now your sales representative.`,
  withdrawn: (name: string) => `${name} withdrew this proposal.`,
  changesRequested: (name: string, count: number, revision: number, total: string) =>
    `${name} requested ${count} ${plural(count, 'change', 'changes')} to revision ${revision} (${total} if all approved).`,
  requestWithdrawn: (name: string) => `${name} withdrew their change request.`,
  decided: (
    name: string,
    approved: number,
    requested: number,
    revision: number,
    total: string,
    revised: boolean,
  ) => {
    const summary = `${name} approved ${approved} of ${requested} requested ${plural(requested, 'change', 'changes')}`;
    return revised
      ? `${summary}. Revision ${revision}: ${total}.`
      : `${summary}. Revision ${revision} stands at ${total}.`;
  },
  signed: (name: string, revision: number, total: string) =>
    `${name} signed revision ${revision} at ${total}.`,
  declined: (name: string) => `${name} declined this proposal.`,
  agreementSent: (name: string, reference: string) =>
    `${name} sent purchase agreement ${reference} for signature.`,
  agreementSigned: (name: string, reference: string, signed: number, total: number) =>
    `${name} signed purchase agreement ${reference} (${signed} of ${total} ${plural(total, 'purchaser', 'purchasers')}).`,
  agreementAllSigned: (reference: string) =>
    `Every purchaser has signed purchase agreement ${reference}; it is waiting to be countersigned.`,
  agreementExecuted: (name: string, reference: string) =>
    `${name} countersigned purchase agreement ${reference}. It is now executed.`,
  agreementAmended: (name: string, reference: string, invalidated: number) =>
    invalidated === 0
      ? `${name} changed purchase agreement ${reference}.`
      : `${name} changed purchase agreement ${reference}; ${invalidated} ${plural(invalidated, 'signature is', 'signatures are')} no longer valid and must be given again.`,
  agreementVoidedByPrice: (reference: string, total: string) =>
    `The price changed to ${total}, so purchase agreement ${reference} is void and this proposal is back in negotiation.`,
  agreementCancelled: (name: string, reference: string, reason?: string) =>
    `${name} cancelled purchase agreement ${reference}.${reason ? ` ${reason}` : ''}`,
} as const;

export const CHANGE_LABELS = {
  unknownPackage: 'package',
  unknownItem: 'option',
  addToPackageItems: (item: string, pkg: string, area: string) =>
    `Add ${item} to ${pkg} items (${area})`,
  add: (item: string, area: string) => `Add ${item} (${area})`,
  removeFromPackage: (item: string, pkg: string, area: string) =>
    `Remove ${item} from ${pkg} package (${area})`,
  remove: (item: string, area: string) => `Remove ${item} (${area})`,
  removePackage: (pkg: string, area: string) => `Remove ${pkg} package (${area})`,
  switchPackage: (area: string, from: string, to: string) => `Change ${area}: ${from} → ${to}`,
  choosePackage: (pkg: string, area: string) => `Choose ${pkg} package (${area})`,
} as const;

export const AGREEMENT_TEXT = {
  none: '—',
  and: 'and',
  separator: ', ',
  noConditions: 'None. This agreement is firm.',
  instalment: (amount: string, label: string, due?: string) =>
    `${amount} ${label}${due ? ` (due ${due})` : ''}`,
  condition: (label: string, details?: string, by?: string) =>
    `${label}${details ? `: ${details}` : ''}${by ? ` (by ${by})` : ''}`,
  lotToBeAssigned: 'Lot to be assigned',
  noSpecialTerms: 'None.',
  closingToBeConfirmed: 'a date the Seller will confirm in writing',
  homeAt: (model: string, place: string) => `${model} home at ${place}`,
  homeBuiltToOrder: (model: string) => `a new home built to order on ${model} floor plan`,
  /** "HST 13%" or "GST 5% and QST 9.975%", then the province. */
  taxDetails: (rates: string[], province: string) =>
    `${rates.length > 1 ? `${rates.slice(0, -1).join(', ')} and ${rates.at(-1)}` : (rates[0] ?? '')}, ${province}`,
  taxRate: (label: string, rate: string) => `${label} ${rate}`,
  noSalesTax: 'no sales tax applies',
  referralSummary: (referrer: string, program: string, credit: string | null) =>
    credit
      ? `The Buyer was referred by ${referrer} under the ${program} program and receives a credit of ${credit}, included in the purchase price.`
      : `The Buyer was referred by ${referrer} under the ${program} program.`,
  noReferral: 'No referral credit applies.',
  article: 'the',
  utc: 'UTC',
  pdf: {
    subject: (reference: string) => `Purchase agreement ${reference}`,
    creator: 'Homepact',
    status: {
      draft: 'Draft: not yet sent to the purchasers.',
      under_review: (date: string) => `Sent to the purchasers for signature on ${date}.`,
      signed: (date: string) =>
        `Signed by every purchaser on ${date}; waiting for the Seller to countersign.`,
      executed: (date: string) => `Executed on ${date}: signed by every party.`,
      cancelled: (date: string) => `Cancelled on ${date}. This agreement is void.`,
    },
    watermark: { draft: 'DRAFT', cancelled: 'VOID' },
    meta: (reference: string, prepared: string, proposal: string, revision: number) =>
      `Agreement ${reference}  ·  Prepared ${prepared}  ·  From proposal ${proposal}, revision ${revision}`,
    seller: 'Seller',
    buyer: 'Buyer',
    signatures: 'Signatures',
    forTheSeller: 'For the Seller',
    purchaser: (n: number, count: number) =>
      count > 1 ? `Purchaser ${n} of ${count}` : 'Purchaser',
    initialled: (clauses: string) => `Initialled clauses ${clauses}`,
    deposits: 'Deposit schedule',
    conditions: 'Conditions',
    noConditions: 'None',
    certificateTitle: 'Certificate of signatures',
    certificateIntro:
      'This page records how each signature was captured. It is part of the executed agreement.',
    documentLabel: 'Document',
    documentHash: 'Document fingerprint (SHA-256 of the signed content)',
    roleColumn: 'Role',
    timeColumn: 'Time (UTC)',
    ipColumn: 'IP address',
    hashColumn: 'Content signed',
    providerColumn: 'Captured by',
    roleBuyer: 'Purchaser',
    roleSeller: 'For the Seller (countersignature)',
    noIp: 'not recorded',
    certificateFooter: (reference: string, stamp: string) =>
      `Agreement ${reference} executed ${stamp}.`,
    signedElectronicallyBy: (name: string) => `Signed electronically by ${name}`,
    signedOn: (stamp: string) => `on ${stamp}`,
    signatureLine: 'Signature, name and date',
    fingerprintNote:
      'Each party signs electronically by typing their name after reviewing the content identified by this fingerprint:',
    fingerprint: (hash: string) => `SHA-256 ${hash}`,
    scheduleTitle: 'Schedule A: the home and its price',
    inventoryHome: 'Pre-existing home, sold as configured',
    builtToOrder: 'Built to order',
    sqft: (sqft: string) => `${sqft} sq ft`,
    bedrooms: (n: number) => `${n} bedrooms`,
    bathrooms: (n: number) => `${n} bathrooms`,
    garage: (n: number) => `${n}-car garage`,
    storeys: (n: number) => `${n} storeys`,
    acceptedIn: (proposal: string, revision: number, name: string, stamp: string) =>
      `As accepted in proposal ${proposal}, revision ${revision}, signed by ${name} on ${stamp}.`,
    basePrice: (model: string) => `${model}: base price`,
    packageLine: (name: string) => `${name} package`,
    included: 'Included',
    adjustments: 'Adjustments',
    referral: 'Referral',
    referralLine: (program: string, referrer: string) =>
      `${program} credit: referred by ${referrer}`,
    priceBeforeTax: 'Purchase price before tax',
    salesTax: (province: string) => `Sales tax: ${province}`,
    taxLine: (label: string, rate: string) => `${label} (${rate})`,
    noSalesTax: 'No sales tax',
    totalWithTax: 'Purchase price, sales tax included',
    purchasePrice: 'Purchase price',
    deposit: 'Deposit on signing',
    balance: 'Balance due on closing',
    closing: 'Closing and possession',
    closingToBeConfirmed: 'To be confirmed',
    footer: (seller: string, reference: string) => `${seller}  ·  Agreement ${reference}`,
    page: (n: number, count: number) => `Page ${n} of ${count}`,
  },
} as const;
