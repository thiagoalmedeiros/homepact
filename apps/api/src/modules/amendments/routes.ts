import {
  AccessResourceType,
  AgreementStatus,
  amendmentApproveSchema,
  amendmentCloseSchema,
  amendmentFileName,
  amendmentIssueSchema,
  amendmentListQuerySchema,
  amendmentPolicySchema,
  amendmentPreviewSchema,
  amendmentPriceSchema,
  amendmentRejectSchema,
  amendmentRequestSchema,
  amendmentSignSchema,
  AmendmentAction,
  AmendmentStatus,
  applyAmendment,
  approvalReasons,
  ChangeDecision,
  ChangeError,
  changeDeltas,
  COMPANY_ROLES,
  formatMoney,
  GuestRole,
  isOpenAmendment,
  isUnsignedAmendment,
  Party,
  QuoteError,
  Role,
  SignerStatus,
  STAFF_ROLES,
  type AgreementPurchaser,
  type AmendmentActor,
  type AmendmentEvent,
  type AmendmentIssued,
  type AmendmentPreview,
  type AmendmentPricingSource,
  type AmendmentState,
  type AgreementCurrent,
  type AmendmentChange,
  type AmendmentDraftPreview,
  type Change,
  type Selections,
  type SignerInvitation,
} from '@homepact/shared';
import { Router, type Request } from 'express';
import type { z } from 'zod';
import { isCompanyMember, isStaff } from '../../auth/require-auth.js';
import type { ModuleContext } from '../../context.js';
import { newId, reference, sha256 } from '../../data/ids.js';
import { conflict, forbidden, notFound, parse, unprocessable } from '../../http/errors.js';
import { AGREEMENT_TEXT, ERRORS, NAMES, THREAD } from '../../messages.js';
import { assertKeyActive } from '../access-keys/keys.js';
import { identityOf } from '../agreements/purchasers.js';
import type { SignatureEnvelope, SignerRef } from '../agreements/signature-provider.js';
import {
  allSigned,
  fileBytes,
  invalidateSignatures,
  signedCount,
  type AgreementDoc,
  type AgreementFileDoc,
} from '../agreements/store.js';
import { loadCatalog } from '../catalog/store.js';
import { loadHouse } from '../houses/pricing.js';
import { toDetail, type HouseDoc } from '../houses/store.js';
import { heldFor } from '../payments/store.js';
import {
  addMessage,
  authorName,
  describeChange,
  loadProposalFor,
  type ProposalDoc,
  type RevisionDoc,
} from '../proposals/store.js';
import { amendmentContentHash } from './document.js';
import { renderAmendmentPdf } from './pdf.js';
import {
  amendmentsOf,
  claimAgreement,
  latestExecutedOf,
  loadPolicy,
  openAmendmentOf,
  releaseAgreement,
  savePolicy,
  stateOf,
  toAmendment,
  toAmendmentSummary,
  type AmendmentDoc,
} from './store.js';

const signerRef = (p: AgreementPurchaser): SignerRef => ({
  id: p.id,
  name: p.name,
  ...(p.email && { email: p.email }),
  ...(p.phone && { phone: p.phone }),
});

/** Pricing errors are the caller's: a change that does not apply, or an option not on offer. */
const priced = <T>(price: () => T): T => {
  try {
    return price();
  } catch (err) {
    if (err instanceof ChangeError || err instanceof QuoteError) throw unprocessable(err.message);
    throw err;
  }
};

/** Change orders on an executed agreement at `/agreements/:agreementId/amendments`. The buyer (or
 * sales for them) requests catalog changes; sales prices them and signs for the company when
 * sending; every purchaser signs on their own link; an administrator approves when the policy
 * asks. The executed agreement is never written: the amendment carries the state after it. */
export const amendmentRoutes = (ctx: ModuleContext): Router => {
  const { guards, now, signatures } = ctx;
  const router = Router({ mergeParams: true });
  const staffOnly = guards.requireRole(...STAFF_ROLES);
  const requesters = guards.requireRole(...STAFF_ROLES, Role.Buyer, GuestRole.KeyHolder);
  const buyerOnly = guards.requireRole(Role.Buyer, GuestRole.KeyHolder);
  const signerOnly = guards.requireRole(GuestRole.KeyHolder);
  const adminOnly = guards.requireRole(Role.CompanyAdmin);
  router.use(guards.requireAuth);

  const amendments = (req: Request) => amendmentsOf(req.repo);
  const files = (req: Request) => req.repo.of<AgreementFileDoc>('agreementFiles');
  const agreementIdOf = (req: Request) => req.params['agreementId'] as string;
  const amendmentIdOf = (req: Request) => req.params['amendmentId'] as string;

  const isAmendmentLink = (req: Request) =>
    req.principal?.role === GuestRole.KeyHolder &&
    req.principal.resource?.type === AccessResourceType.Amendment;

  /** The agreement, for anyone in the company or its buyer (account or proposal link). Signing
   * links only open what they were sent to sign. */
  const loadAgreementFor = async (req: Request): Promise<AgreementDoc> => {
    const p = req.principal!;
    if (p.role === GuestRole.KeyHolder && p.resource?.type !== AccessResourceType.Proposal) {
      throw forbidden(ERRORS.amendments.signingLinkOnly);
    }
    const doc = await req.repo.of<AgreementDoc>('agreements').findOne({ _id: agreementIdOf(req) });
    if (!doc) throw notFound(ERRORS.payments.agreementNotFound);
    if (isCompanyMember(p)) return doc;
    if (!doc.issuedAt) throw notFound(ERRORS.payments.agreementNotFound);
    await loadProposalFor(req, doc.proposalId);
    return doc;
  };

  const findAmendment = async (req: Request): Promise<AmendmentDoc> => {
    const doc = await amendments(req).findOne({
      _id: amendmentIdOf(req),
      agreementId: agreementIdOf(req),
    });
    if (!doc) throw notFound(ERRORS.amendments.notFound);
    return doc;
  };

  /** An amendment for a reader of its agreement, or for a purchaser on its own signing link. */
  const loadAmendmentFor = async (req: Request): Promise<AmendmentDoc> => {
    if (isAmendmentLink(req)) {
      if (req.principal!.resource!.id !== amendmentIdOf(req)) throw notFound();
      await assertKeyActive(req);
      return findAmendment(req);
    }
    await loadAgreementFor(req);
    return findAmendment(req);
  };

  const actorOf = (req: Request, name = req.principal!.name): AmendmentActor => ({
    id: req.principal!.sub,
    name,
    role: req.principal!.role,
  });
  const event = (actor: AmendmentActor, at: Date, action: AmendmentAction, reason?: string) =>
    ({ at: at.toISOString(), by: actor, action, ...(reason && { reason }) }) as AmendmentEvent;

  const envelopeOf = (doc: AmendmentDoc): SignatureEnvelope => ({
    agreementId: doc.agreementId,
    reference: doc.reference,
    title: AGREEMENT_TEXT.amendment.title(doc.number, doc.agreementReference),
    contentHash: doc.contentHash ?? '',
    resource: { type: AccessResourceType.Amendment, id: doc._id },
  });
  const signatureContext = (req: Request, at: Date) => ({
    repo: req.repo,
    now: at,
    actorId: req.principal!.sub,
  });
  const money = (doc: Pick<AmendmentDoc, 'currency'>, cents: number) =>
    formatMoney(cents, doc.currency);

  const tellProposal = async (req: Request, proposalId: string, body: string, at: Date) => {
    await addMessage(req.repo, proposalId, Party.System, NAMES.system, body, at);
    await req.repo
      .of<ProposalDoc>('proposals')
      .updateOne(
        { _id: proposalId },
        { $set: { lastActivityAt: at.toISOString(), updatedAt: at.toISOString() } },
      );
  };

  /** The agreement's current state and the selections its next amendment starts from. */
  const currentOf = async (req: Request, agreement: AgreementDoc) => {
    const [state, latest] = await Promise.all([
      stateOf(req.repo, agreement),
      latestExecutedOf(req.repo, agreement._id),
    ]);
    let selections: Selections;
    if (latest) {
      selections = latest.after!.selections;
    } else {
      const revision = await req.repo.of<RevisionDoc>('revisions').findOne({
        proposalId: agreement.proposalId,
        number: agreement.proposalSignature.revision,
      });
      if (!revision) throw notFound(ERRORS.agreements.signedRevisionNotFound);
      selections = revision.selections;
    }
    return { state, selections, latest };
  };

  /** Today's catalog and the plan's own prices, to price what is added. */
  const pricingSource = async (req: Request, houseId: string): Promise<AmendmentPricingSource> => {
    const [catalog, house] = await Promise.all([
      loadCatalog(req.repo),
      req.repo.of<HouseDoc>('houses').findOne({ _id: houseId }),
    ]);
    return { catalog, priceOverrides: house?.priceOverrides ?? [] };
  };

  const beforeOf = async (req: Request, agreement: AgreementDoc) => {
    const { state, selections, latest } = await currentOf(req, agreement);
    const before: AmendmentState = { selections, quote: state.quote, terms: state.terms };
    return { before, latest, source: await pricingSource(req, state.quote.houseId) };
  };

  /** Each change with what it reads like and what it alone adds to the price before tax. */
  const labelled = (before: AmendmentState, changes: Change[], source: AmendmentPricingSource) => {
    const deltas = changeDeltas(before, changes, source);
    return changes.map((change, i) => ({
      change,
      label: describeChange(change, before.selections, source.catalog),
      deltaCents: deltas[i]!,
    }));
  };

  /** Writes `set` on the amendment if it is still as read; a conflict otherwise. */
  const update = async (
    req: Request,
    current: AmendmentDoc,
    set: Partial<AmendmentDoc>,
    unset: string[] = [],
  ): Promise<AmendmentDoc> => {
    const doc = await amendments(req).findOneAndUpdate(
      { _id: current._id, status: current.status, updatedAt: current.updatedAt },
      {
        $set: set,
        ...(unset.length && { $unset: Object.fromEntries(unset.map((k) => [k, ''])) }),
      },
    );
    if (!doc) throw conflict(ERRORS.amendments.changedReload);
    return doc;
  };

  /** Executes an amendment that holds its agreement (so the one numbered after the last one
   * executed): renders and keeps its PDF, then frees the agreement for the next one. */
  const execute = async (
    req: Request,
    current: AmendmentDoc,
    set: Partial<AmendmentDoc>,
    at: Date,
  ): Promise<AmendmentDoc> => {
    const ts = at.toISOString();
    const history = [
      ...(set.history ?? current.history),
      event(actorOf(req), at, AmendmentAction.Executed),
    ];
    const executed = {
      ...set,
      status: AmendmentStatus.Executed,
      executedAt: ts,
      updatedAt: ts,
      history,
    };
    const pdf = await renderAmendmentPdf(toAmendment({ ...current, ...executed }));
    const executedPdf = { fileId: newId(), sha256: sha256(pdf), size: pdf.length };
    await files(req).insertOne({
      _id: executedPdf.fileId,
      agreementId: current.agreementId,
      amendmentId: current._id,
      kind: 'amendment',
      contentType: 'application/pdf',
      data: pdf,
      sha256: executedPdf.sha256,
      size: executedPdf.size,
      createdAt: ts,
    });
    let doc: AmendmentDoc;
    try {
      doc = await update(req, current, { ...executed, executedPdf });
    } catch (err) {
      await files(req).deleteOne({ _id: executedPdf.fileId });
      throw err;
    }
    await releaseAgreement(req.repo, doc.agreementId, doc._id, at);
    await signatures.revoke(signatureContext(req, at), envelopeOf(doc));
    return doc;
  };

  /** Tells the proposal thread what the executed amendment does to the money: the new price
   * and, when it fell below what was received, what is owed back to the buyer. */
  const tellExecuted = async (req: Request, doc: AmendmentDoc, at: Date) => {
    const total = doc.after!.quote.totalCents;
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.amendmentExecuted(doc.reference, doc.agreementReference, money(doc, total)),
      at,
    );
    const held = await heldFor(req.repo, doc.agreementId);
    if (held > total) {
      await tellProposal(
        req,
        doc.proposalId,
        THREAD.amendmentCredit(money(doc, held), money(doc, held - total)),
        at,
      );
    }
  };

  /** Closes an amendment that did not take effect and frees its agreement. */
  const close = async (
    req: Request,
    current: AmendmentDoc,
    status: AmendmentStatus.Declined | AmendmentStatus.Withdrawn | AmendmentStatus.Rejected,
    actor: AmendmentActor,
    reason: string | undefined,
    at: Date,
  ): Promise<AmendmentDoc> => {
    const ts = at.toISOString();
    const action = {
      [AmendmentStatus.Declined]: AmendmentAction.Declined,
      [AmendmentStatus.Withdrawn]: AmendmentAction.Withdrawn,
      [AmendmentStatus.Rejected]: AmendmentAction.Rejected,
    }[status];
    const doc = await update(req, current, {
      status,
      closedAt: ts,
      closedBy: actor,
      ...(reason && { closeReason: reason }),
      updatedAt: ts,
      history: [...current.history, event(actor, at, action, reason)],
    });
    await releaseAgreement(req.repo, doc.agreementId, doc._id, at);
    await signatures.revoke(signatureContext(req, at), envelopeOf(doc));
    return doc;
  };

  /** The amendment as sales shapes it: each requested change decided, the catalog changes sales
   * adds, fees, credits and instalments, priced with tax, and whether it will need approval. */
  const draftOf = async (
    req: Request,
    agreement: AgreementDoc,
    current: AmendmentDoc,
    input: z.output<typeof amendmentPriceSchema>,
  ): Promise<AmendmentDraftPreview> => {
    const requested = current.changes.filter((c) => !c.addedBySeller);
    const decided = new Map(input.decisions.map((d) => [d.changeId, d]));
    if (decided.size !== requested.length || requested.some((c) => !decided.has(c.id))) {
      throw unprocessable(ERRORS.proposals.decideEveryChange);
    }
    const approved = requested.filter((c) => decided.get(c.id)!.approved);
    const changesTerms = input.deposits.length > 0 || !!input.closingDate;
    if (!approved.length && !input.added.length && !input.adjustments.length && !changesTerms) {
      throw unprocessable(ERRORS.amendments.nothingToAmend);
    }
    const source = await pricingSource(req, current.before.quote.houseId);
    const after = priced(() =>
      applyAmendment(current.before, [...approved.map((c) => c.change), ...input.added], source, {
        adjustments: input.adjustments,
        deposits: input.deposits,
        closingDate: input.closingDate,
      }),
    );
    if (after.terms.depositCents > after.quote.totalCents) {
      throw unprocessable(ERRORS.agreements.depositAbovePrice);
    }
    const [policy, held] = await Promise.all([
      loadPolicy(req.repo),
      heldFor(req.repo, agreement._id),
    ]);
    const reasons = approvalReasons(policy, {
      before: current.before.quote,
      after: after.quote,
      adjustments: input.adjustments,
      heldCents: held,
    });
    const changes: AmendmentChange[] = [
      ...requested.map(({ decision: _d, decisionNote: _n, ...c }) => {
        const d = decided.get(c.id)!;
        return {
          ...c,
          decision: d.approved ? ChangeDecision.Approved : ChangeDecision.Declined,
          ...(d.note && { decisionNote: d.note }),
        };
      }),
      ...labelled(current.before, input.added, source).map((c) => ({
        id: newId(),
        ...c,
        decision: ChangeDecision.Approved,
        addedBySeller: true as const,
      })),
    ];
    return { changes, after, approval: { required: reasons.length > 0, reasons } };
  };

  const assertUnsigned = (doc: AmendmentDoc) => {
    if (!isOpenAmendment(doc.status)) throw conflict(ERRORS.amendments.closed);
    if (!isUnsignedAmendment(doc.status)) throw conflict(ERRORS.amendments.signedCannotChange);
  };

  router.get('/', async (req, res) => {
    const agreement = await loadAgreementFor(req);
    const docs = await amendments(req).find(
      { agreementId: agreement._id },
      { sort: { createdAt: 1 } },
    );
    res.json(docs.map((d) => toAmendment(d)));
  });

  router.get('/current', async (req, res) => {
    const agreement = await loadAgreementFor(req);
    const [{ state, selections }, open, proposal] = await Promise.all([
      currentOf(req, agreement),
      openAmendmentOf(req.repo, agreement._id),
      req.repo.of<ProposalDoc>('proposals').findOne({ _id: agreement.proposalId }),
    ]);
    res.json({
      state,
      selections,
      ...(open && { openAmendmentId: open }),
      ...(proposal?.locked && { offeredAsIs: true }),
    } satisfies AgreementCurrent);
  });

  router.get('/options', async (req, res) => {
    const agreement = await loadAgreementFor(req);
    const [{ state, selections }, catalog] = await Promise.all([
      currentOf(req, agreement),
      loadCatalog(req.repo),
    ]);
    const house = await loadHouse(req, state.quote.houseId);
    res.json({ options: toDetail(house, catalog, agreement.currency), selections });
  });

  router.post('/preview', requesters, async (req, res) => {
    const { changes } = parse(amendmentPreviewSchema, req.body);
    const agreement = await loadAgreementFor(req);
    const { before, source } = await beforeOf(req, agreement);
    const after = priced(() => applyAmendment(before, changes, source));
    res.json({
      quote: after.quote,
      changes: labelled(before, changes, source).map(({ label, deltaCents }) => ({
        label,
        deltaCents,
      })),
    } satisfies AmendmentPreview);
  });

  router.post('/', requesters, async (req, res) => {
    const input = parse(amendmentRequestSchema, req.body);
    const agreement = await loadAgreementFor(req);
    if (agreement.status !== AgreementStatus.Executed) {
      throw conflict(ERRORS.amendments.onlyExecuted);
    }
    const proposal = await req.repo
      .of<ProposalDoc>('proposals')
      .findOne({ _id: agreement.proposalId });
    const fromBuyer = !isStaff(req.principal);
    if (fromBuyer && proposal?.locked) throw forbidden(ERRORS.amendments.offeredAsIs);

    const at = now();
    const id = newId();
    if (!(await claimAgreement(req.repo, agreement._id, id, at))) {
      throw conflict(ERRORS.amendments.oneAtATime);
    }
    let doc: AmendmentDoc;
    try {
      const { before, latest, source } = await beforeOf(req, agreement);
      priced(() => applyAmendment(before, input.changes, source));
      const name = fromBuyer ? authorName(req, proposal ?? agreement) : req.principal!.name;
      const ts = at.toISOString();
      doc = await amendments(req).insertOne({
        _id: id,
        reference: reference('CO'),
        number: (latest?.number ?? 0) + 1,
        agreementId: agreement._id,
        agreementReference: agreement.reference,
        proposalId: agreement.proposalId,
        status: AmendmentStatus.Requested,
        basis: latest
          ? { number: latest.number, contentHash: latest.contentHash! }
          : { number: 0, contentHash: agreement.contentHash },
        requestedBy: { party: fromBuyer ? Party.Buyer : Party.Seller, name },
        ...(input.note && { note: input.note }),
        changes: labelled(before, input.changes, source).map((c) => ({ id: newId(), ...c })),
        adjustments: [],
        deposits: [],
        before,
        seller: agreement.seller,
        home: agreement.home,
        purchasers: agreement.purchasers.map((p) => ({
          ...identityOf(p),
          status: SignerStatus.Pending,
        })),
        currency: agreement.currency,
        history: [event(actorOf(req, name), at, AmendmentAction.Requested)],
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (err) {
      await releaseAgreement(req.repo, agreement._id, id, at);
      throw err;
    }
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.amendmentRequested(
        doc.requestedBy.name,
        doc.agreementReference,
        doc.changes.length,
        doc.reference,
      ),
      at,
    );
    if (input.note) {
      await addMessage(
        req.repo,
        doc.proposalId,
        fromBuyer ? Party.Buyer : Party.Seller,
        doc.requestedBy.name,
        input.note,
        at,
      );
    }
    res.status(201).json(toAmendment(doc));
  });

  router.get('/:amendmentId', async (req, res) => {
    const doc = await loadAmendmentFor(req);
    res.json(toAmendment(doc, isAmendmentLink(req) ? req.principal!.signerId : undefined));
  });

  router.get('/:amendmentId/pdf', async (req, res) => {
    const doc = await loadAmendmentFor(req);
    let pdf: Buffer | undefined;
    if (doc.executedPdf) {
      const file = await files(req).findOne({
        _id: doc.executedPdf.fileId,
        amendmentId: doc._id,
      });
      if (file) pdf = fileBytes(file.data);
    }
    pdf ??= await renderAmendmentPdf(toAmendment(doc));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${amendmentFileName(doc.reference, doc.status)}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    });
    res.end(pdf);
  });

  router.post('/:amendmentId/price-preview', staffOnly, async (req, res) => {
    const input = parse(amendmentPriceSchema, req.body);
    const agreement = await loadAgreementFor(req);
    const current = await findAmendment(req);
    assertUnsigned(current);
    res.json(await draftOf(req, agreement, current, input));
  });

  router.put('/:amendmentId', staffOnly, async (req, res) => {
    const input = parse(amendmentPriceSchema, req.body);
    const agreement = await loadAgreementFor(req);
    const current = await findAmendment(req);
    assertUnsigned(current);
    const at = now();
    const ts = at.toISOString();
    const { changes, after, approval } = await draftOf(req, agreement, current, input);
    const wasSent = current.status === AmendmentStatus.UnderReview;
    const { purchasers, invalidated } = wasSent
      ? invalidateSignatures(current.purchasers, at)
      : { purchasers: current.purchasers, invalidated: 0 };
    const { pricingNote: _previous, closingDate: _moved, ...rest } = current;
    const content = {
      ...rest,
      changes,
      adjustments: input.adjustments,
      deposits: input.deposits,
      after,
      pricedAt: ts,
      ...(input.note && { pricingNote: input.note }),
      ...(input.closingDate && { closingDate: input.closingDate }),
    };
    const doc = await update(
      req,
      current,
      {
        status: AmendmentStatus.Priced,
        changes,
        adjustments: input.adjustments,
        deposits: input.deposits,
        after,
        approval,
        contentHash: amendmentContentHash(content),
        pricedAt: ts,
        pricedBy: actorOf(req),
        purchasers,
        ...(input.note && { pricingNote: input.note }),
        ...(input.closingDate && { closingDate: input.closingDate }),
        updatedAt: ts,
        history: [...current.history, event(actorOf(req), at, AmendmentAction.Priced)],
      },
      [
        ...(input.note ? [] : ['pricingNote']),
        ...(input.closingDate ? [] : ['closingDate']),
        ...(wasSent ? ['issuedAt', 'issuedBy', 'sellerSignature'] : []),
      ],
    );
    if (wasSent) {
      await signatures.revoke(signatureContext(req, at), envelopeOf(doc));
      await tellProposal(
        req,
        doc.proposalId,
        THREAD.amendmentRepriced(req.principal!.name, doc.reference, invalidated),
        at,
      );
    }
    res.json(toAmendment(doc));
  });

  router.post('/:amendmentId/issue', staffOnly, async (req, res) => {
    const input = parse(amendmentIssueSchema, req.body);
    const current = await loadAmendmentFor(req);
    if (current.status === AmendmentStatus.Requested) throw conflict(ERRORS.amendments.priceFirst);
    if (current.status !== AmendmentStatus.Priced) {
      throw conflict(
        isOpenAmendment(current.status) ? ERRORS.amendments.alreadySent : ERRORS.amendments.closed,
      );
    }
    if (current.contentHash !== input.contentHash) {
      throw conflict(ERRORS.amendments.changedReview);
    }
    const at = now();
    const ts = at.toISOString();
    const envelope = envelopeOf(current);
    const sellerSignature = await signatures.capture(
      signatureContext(req, at),
      envelope,
      { id: req.principal!.sub, name: req.principal!.name },
      {
        fullName: input.fullName,
        initials: [],
        contentHash: input.contentHash,
        ...(req.ip && { ip: req.ip }),
      },
    );
    const doc = await update(req, current, {
      status: AmendmentStatus.UnderReview,
      issuedAt: ts,
      issuedBy: actorOf(req),
      sellerSignature,
      purchasers: current.purchasers.map((p) => ({ ...p, invitedAt: ts })),
      updatedAt: ts,
      history: [...current.history, event(actorOf(req), at, AmendmentAction.Sent)],
    });
    const invitations = await signatures.invite(
      signatureContext(req, at),
      envelope,
      doc.purchasers.filter((p) => p.status !== SignerStatus.Signed).map(signerRef),
    );
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.amendmentSent(
        req.principal!.name,
        doc.reference,
        money(doc, doc.before.quote.totalCents),
        money(doc, doc.after!.quote.totalCents),
      ),
      at,
    );
    res.json({ amendment: toAmendment(doc), invitations } satisfies AmendmentIssued);
  });

  router.post('/:amendmentId/purchasers/:purchaserId/invite', staffOnly, async (req, res) => {
    const current = await loadAmendmentFor(req);
    const purchaser = current.purchasers.find((p) => p.id === req.params['purchaserId']);
    if (!purchaser) throw notFound(ERRORS.amendments.purchaserNotFound);
    if (current.status !== AmendmentStatus.UnderReview) throw conflict(ERRORS.amendments.notSent);
    const [invitation] = await signatures.invite(
      signatureContext(req, now()),
      envelopeOf(current),
      [signerRef(purchaser)],
    );
    res.status(201).json(invitation satisfies SignerInvitation | undefined);
  });

  router.post('/:amendmentId/sign', signerOnly, async (req, res) => {
    const input = parse(amendmentSignSchema, req.body);
    const p = req.principal!;
    if (!isAmendmentLink(req) || p.resource!.id !== amendmentIdOf(req) || !p.signerId) {
      throw forbidden(ERRORS.amendments.notASigner);
    }
    await assertKeyActive(req);
    const current = await findAmendment(req);
    const purchaser = current.purchasers.find((x) => x.id === p.signerId);
    if (!purchaser) throw forbidden(ERRORS.amendments.notASigner);
    if (current.status !== AmendmentStatus.UnderReview) {
      throw conflict(ERRORS.amendments.notOpenForSignature);
    }
    if (purchaser.status === SignerStatus.Signed) throw conflict(ERRORS.amendments.alreadySigned);
    if (current.contentHash !== input.contentHash) {
      throw conflict(ERRORS.amendments.changedReview);
    }

    const at = now();
    const ts = at.toISOString();
    const signature = await signatures.capture(
      signatureContext(req, at),
      envelopeOf(current),
      signerRef(purchaser),
      {
        fullName: input.fullName,
        initials: [],
        contentHash: input.contentHash,
        ...(req.ip && { ip: req.ip }),
      },
    );
    const { invalidatedAt: _previous, ...identity } = purchaser;
    const purchasers = current.purchasers.map((x) =>
      x.id === purchaser.id ? { ...identity, status: SignerStatus.Signed, signature } : x,
    );
    const signer = actorOf(req, purchaser.name);
    const history = [...current.history, event(signer, at, AmendmentAction.Signed)];
    const signedMessage = THREAD.amendmentSigned(
      input.fullName,
      current.reference,
      signedCount(purchasers),
      purchasers.length,
    );

    if (!allSigned(purchasers)) {
      const doc = await update(req, current, { purchasers, updatedAt: ts, history });
      await tellProposal(req, doc.proposalId, signedMessage, at);
      res.json(toAmendment(doc, purchaser.id));
      return;
    }

    const [policy, held] = await Promise.all([
      loadPolicy(req.repo),
      heldFor(req.repo, current.agreementId),
    ]);
    const reasons = approvalReasons(policy, {
      before: current.before.quote,
      after: current.after!.quote,
      adjustments: current.adjustments,
      heldCents: held,
    });
    const approval = { required: reasons.length > 0, reasons };
    const signed = { purchasers, signedAt: ts, approval, updatedAt: ts };
    if (approval.required) {
      const doc = await update(req, current, {
        ...signed,
        status: AmendmentStatus.AwaitingApproval,
        history: [...history, event(signer, at, AmendmentAction.AwaitingApproval)],
      });
      await signatures.revoke(signatureContext(req, at), envelopeOf(doc));
      await tellProposal(req, doc.proposalId, signedMessage, at);
      await tellProposal(req, doc.proposalId, THREAD.amendmentAwaitingApproval(doc.reference), at);
      res.json(toAmendment(doc, purchaser.id));
      return;
    }
    const doc = await execute(req, current, { ...signed, history }, at);
    await tellProposal(req, doc.proposalId, signedMessage, at);
    await tellExecuted(req, doc, at);
    res.json(toAmendment(doc, purchaser.id));
  });

  router.post('/:amendmentId/approve', adminOnly, async (req, res) => {
    const input = parse(amendmentApproveSchema, req.body);
    const current = await loadAmendmentFor(req);
    if (current.status !== AmendmentStatus.AwaitingApproval) {
      throw conflict(ERRORS.amendments.notAwaitingApproval);
    }
    const me = req.principal!.sub;
    if (current.pricedBy?.id === me || current.issuedBy?.id === me) {
      throw forbidden(ERRORS.amendments.cannotApproveOwn);
    }
    if (current.contentHash !== input.contentHash) {
      throw conflict(ERRORS.amendments.changedReview);
    }
    const at = now();
    const approvalSignature = await signatures.capture(
      signatureContext(req, at),
      envelopeOf(current),
      { id: me, name: req.principal!.name },
      {
        fullName: input.fullName,
        initials: [],
        contentHash: input.contentHash,
        ...(req.ip && { ip: req.ip }),
      },
    );
    const doc = await execute(
      req,
      current,
      {
        approvedAt: at.toISOString(),
        approvedBy: actorOf(req),
        approvalSignature,
        ...(input.note && { approvalNote: input.note }),
        history: [...current.history, event(actorOf(req), at, AmendmentAction.Approved)],
      },
      at,
    );
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.amendmentApproved(req.principal!.name, doc.reference),
      at,
    );
    await tellExecuted(req, doc, at);
    res.json(toAmendment(doc));
  });

  router.post('/:amendmentId/reject', adminOnly, async (req, res) => {
    const { reason } = parse(amendmentRejectSchema, req.body);
    const current = await loadAmendmentFor(req);
    if (current.status !== AmendmentStatus.AwaitingApproval) {
      throw conflict(ERRORS.amendments.notAwaitingApproval);
    }
    const at = now();
    const doc = await close(req, current, AmendmentStatus.Rejected, actorOf(req), reason, at);
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.amendmentRejected(req.principal!.name, doc.reference, reason),
      at,
    );
    res.json(toAmendment(doc));
  });

  router.post('/:amendmentId/decline', staffOnly, async (req, res) => {
    const { reason } = parse(amendmentCloseSchema, req.body);
    const current = await loadAmendmentFor(req);
    assertUnsigned(current);
    const at = now();
    const doc = await close(req, current, AmendmentStatus.Declined, actorOf(req), reason, at);
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.amendmentDeclined(req.principal!.name, doc.reference, reason),
      at,
    );
    res.json(toAmendment(doc));
  });

  router.post('/:amendmentId/withdraw', buyerOnly, async (req, res) => {
    const { reason } = parse(amendmentCloseSchema, req.body);
    const agreement = await loadAgreementFor(req);
    const current = await findAmendment(req);
    assertUnsigned(current);
    const proposal = await req.repo
      .of<ProposalDoc>('proposals')
      .findOne({ _id: agreement.proposalId });
    const name = authorName(req, proposal ?? agreement);
    const at = now();
    const doc = await close(
      req,
      current,
      AmendmentStatus.Withdrawn,
      actorOf(req, name),
      reason,
      at,
    );
    await tellProposal(req, doc.proposalId, THREAD.amendmentWithdrawn(name, doc.reference), at);
    res.json(toAmendment(doc));
  });

  return router;
};

/** The company's change orders by status at `/agreement-amendments`, e.g. those waiting for an
 * administrator's approval. */
export const amendmentQueueRoutes = ({ guards }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...COMPANY_ROLES));
  router.get('/', async (req, res) => {
    const { status } = parse(amendmentListQuerySchema, req.query);
    const docs = await amendmentsOf(req.repo).find(status ? { status } : {}, {
      sort: { updatedAt: -1 },
      limit: 300,
    });
    res.json(docs.map(toAmendmentSummary));
  });
  return router;
};

/** When a change order needs an administrator's approval: read by the company, set by an
 * administrator. */
export const amendmentPolicyRoutes = ({ guards, now }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth);
  router.get('/', guards.requireRole(...COMPANY_ROLES), async (req, res) => {
    res.json(await loadPolicy(req.repo));
  });
  router.put('/', guards.requireRole(Role.CompanyAdmin), async (req, res) => {
    const policy = parse(amendmentPolicySchema, req.body);
    res.json(await savePolicy(req.repo, policy, req.principal!.name, now()));
  });
  return router;
};

/** A change order by its id at `/amendments/:amendmentId`, for the page its signing link opens:
 * the purchaser of that link, anyone in the company, or the buyer. */
export const amendmentLookupRoutes = ({ guards }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth);
  router.get('/:amendmentId', async (req, res) => {
    const id = req.params['amendmentId'] as string;
    const p = req.principal!;
    const keyHolder = p.role === GuestRole.KeyHolder;
    const ownLink = keyHolder && p.resource?.type === AccessResourceType.Amendment;
    if (keyHolder && !ownLink && p.resource?.type !== AccessResourceType.Proposal) {
      throw forbidden(ERRORS.amendments.signingLinkOnly);
    }
    if (ownLink) {
      if (p.resource!.id !== id) throw notFound();
      await assertKeyActive(req);
    }
    const doc = await amendmentsOf(req.repo).findOne({ _id: id });
    if (!doc) throw notFound(ERRORS.amendments.notFound);
    if (!ownLink && !isCompanyMember(p)) await loadProposalFor(req, doc.proposalId);
    res.json(toAmendment(doc, ownLink ? p.signerId : undefined));
  });
  return router;
};
