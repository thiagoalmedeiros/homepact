import {
  agreementCancelSchema,
  agreementCountersignSchema,
  agreementCreateSchema,
  agreementFileName,
  agreementIssueSchema,
  agreementListQuerySchema,
  agreementSignSchema,
  AgreementStatus,
  agreementUpdateSchema,
  AccessResourceType,
  COMPANY_ROLES,
  formatMoney,
  GuestRole,
  InventoryStatus,
  isOpenAgreement,
  isoDay,
  keyClauses,
  Party,
  ProposalStatus,
  Role,
  SignerStatus,
  STAFF_ROLES,
  type AgreementIssued,
  type AgreementPreparation,
  type AgreementPurchaser,
  type SignerInvitation,
} from '@homepact/shared';
import { Router, type Request } from 'express';
import { isCompanyMember } from '../../auth/require-auth.js';
import type { ModuleContext } from '../../context.js';
import { newId, reference, sha256 } from '../../data/ids.js';
import { findCompany } from '../../data/platform-repo.js';
import { conflict, forbidden, notFound, parse, unprocessable } from '../../http/errors.js';
import { assertKeyActive } from '../access-keys/keys.js';
import type { AgreementTemplateDoc } from '../agreement-templates/store.js';
import type { HouseDoc } from '../houses/store.js';
import type { InventoryHomeDoc } from '../inventory/store.js';
import { heldFor, paymentSummaries } from '../payments/store.js';
import {
  addMessage,
  loadProposalFor,
  type ProposalDoc,
  type RevisionDoc,
} from '../proposals/store.js';
import { composeAgreement } from './document.js';
import { mergePurchasers, withIds } from './purchasers.js';
import { renderAgreementPdf } from './pdf.js';
import type { SignatureContext, SignatureEnvelope, SignerRef } from './signature-provider.js';
import {
  allSigned,
  fileBytes,
  invalidateSignatures,
  signedCount,
  toAgreement,
  toAgreementSummary,
  voidAgreement,
  type AgreementDoc,
  type AgreementFileDoc,
} from './store.js';
import { ERRORS, NAMES, THREAD } from '../../messages.js';

const signerRef = (p: AgreementPurchaser): SignerRef => ({
  id: p.id,
  name: p.name,
  ...(p.email && { email: p.email }),
  ...(p.phone && { phone: p.phone }),
});

/** Agreements from signed proposals: prepared from a template, signed by each purchaser with their
 * link and code, then countersigned by an administrator. One live agreement per proposal; content
 * changes invalidate signatures. Finance only reads them. */
export const agreementRoutes = (ctx: ModuleContext): Router => {
  const { guards, now, signatures } = ctx;
  const router = Router();
  const staffOnly = guards.requireRole(...STAFF_ROLES);
  const companyOnly = guards.requireRole(...COMPANY_ROLES);
  const signerOnly = guards.requireRole(Role.Buyer, GuestRole.KeyHolder);
  const countersignerOnly = guards.requireRole(Role.CompanyAdmin);
  router.use(guards.requireAuth);

  const agreements = (req: Request) => req.repo.of<AgreementDoc>('agreements');
  const files = (req: Request) => req.repo.of<AgreementFileDoc>('agreementFiles');
  const proposals = (req: Request) => req.repo.of<ProposalDoc>('proposals');
  const id = (req: Request) => req.params['id'] as string;

  const signerIdOf = (req: Request, doc: AgreementDoc): string | undefined => {
    const p = req.principal;
    if (p?.role !== GuestRole.KeyHolder) return undefined;
    if (p.resource?.type !== AccessResourceType.Agreement || p.resource.id !== doc._id)
      return undefined;
    return p.signerId;
  };

  const signatureContext = (req: Request, at: Date): SignatureContext => ({
    repo: req.repo,
    now: at,
    actorId: req.principal!.sub,
  });
  const envelopeOf = (doc: AgreementDoc): SignatureEnvelope => ({
    agreementId: doc._id,
    reference: doc.reference,
    title: doc.title,
    contentHash: doc.contentHash,
  });

  const loadFor = async (req: Request, agreementId: string): Promise<AgreementDoc> => {
    const doc = await agreements(req).findOne({ _id: agreementId });
    if (!doc || !req.principal) throw notFound();
    if (isCompanyMember(req.principal)) return doc;
    if (!doc.issuedAt) throw notFound();
    if (signerIdOf(req, doc)) {
      await assertKeyActive(req);
      return doc;
    }
    await loadProposalFor(req, doc.proposalId);
    return doc;
  };

  const sellerCompany = async (req: Request) => {
    if (req.tenant.kind !== 'company') throw forbidden(ERRORS.tenant.notOnThisOrigin);
    const company = await findCompany(ctx.db, req.tenant.companyId);
    if (!company) throw notFound();
    return company;
  };

  const compose = async (
    req: Request,
    proposal: ProposalDoc,
    input: AgreementPreparation,
    agreementReference: string,
    at: Date,
    existing: AgreementPurchaser[] = [],
  ) => {
    const signature = proposal.signature;
    if (proposal.status !== ProposalStatus.Signed || !signature) {
      throw conflict(ERRORS.agreements.onlySignedProposals);
    }
    const [template, revision, house, company] = await Promise.all([
      req.repo.of<AgreementTemplateDoc>('agreementTemplates').findOne({ _id: input.templateId }),
      req.repo
        .of<RevisionDoc>('revisions')
        .findOne({ proposalId: proposal._id, number: signature.revision }),
      req.repo.of<HouseDoc>('houses').findOne({ _id: proposal.houseId }),
      sellerCompany(req),
    ]);
    if (!template) throw unprocessable(ERRORS.agreements.chooseTemplate);
    if (!revision) throw notFound(ERRORS.agreements.signedRevisionNotFound);
    const deposit = input.deposits.reduce((total, d) => total + d.amountCents, 0);
    if (deposit > revision.quote.totalCents) {
      throw unprocessable(ERRORS.agreements.depositAbovePrice);
    }
    return composeAgreement({
      reference: agreementReference,
      preparedAt: at,
      company,
      proposal: { ...proposal, signature },
      revision,
      house,
      template,
      purchasers: withIds(input.purchasers, existing),
      terms: input,
    });
  };

  const tellProposal = async (req: Request, proposalId: string, body: string, at: Date) => {
    await addMessage(req.repo, proposalId, Party.System, NAMES.system, body, at);
    await proposals(req).updateOne(
      { _id: proposalId },
      { $set: { lastActivityAt: at.toISOString(), updatedAt: at.toISOString() } },
    );
  };

  const homes = (req: Request) => req.repo.of<InventoryHomeDoc>('inventoryHomes');

  const setHomeStatus = async (
    req: Request,
    proposal: ProposalDoc | null,
    status: InventoryStatus,
    at: Date,
  ) => {
    if (!proposal?.inventoryHomeId) return;
    await homes(req).updateOne(
      { _id: proposal.inventoryHomeId },
      { $set: { status, updatedAt: at.toISOString() } },
    );
  };

  const assertHomeNotSold = async (req: Request, proposal: ProposalDoc) => {
    if (!proposal.inventoryHomeId) return;
    const home = await homes(req).findOne({ _id: proposal.inventoryHomeId });
    if (home?.status === InventoryStatus.Sold) throw conflict(ERRORS.agreements.homeSold);
  };

  router.get('/', companyOnly, async (req, res) => {
    const q = parse(agreementListQuerySchema, req.query);
    const docs = await agreements(req).find(
      { ...(q.status && { status: q.status }), ...(q.proposalId && { proposalId: q.proposalId }) },
      { sort: { updatedAt: -1 }, limit: 300 },
    );
    const payments = await paymentSummaries(req.repo, docs, isoDay(now()));
    res.json(
      docs.map((d) => {
        const summary = payments.get(d._id);
        return { ...toAgreementSummary(d), ...(summary && { payments: summary }) };
      }),
    );
  });

  router.post('/', staffOnly, async (req, res) => {
    const input = parse(agreementCreateSchema, req.body);
    const proposal = await proposals(req).findOne({ _id: input.proposalId });
    if (!proposal) throw notFound(ERRORS.proposals.notFound);
    if (proposal.agreementId) throw conflict(ERRORS.agreements.proposalHasAgreement);
    await assertHomeNotSold(req, proposal);
    const at = now();
    const content = await compose(req, proposal, input, reference('A'), at);

    const agreementId = newId();
    const claimed = await proposals(req).findOneAndUpdate(
      { _id: proposal._id, status: ProposalStatus.Signed, agreementId: { $exists: false } },
      { $set: { agreementId } },
    );
    if (!claimed) throw conflict(ERRORS.agreements.proposalHasAgreement);
    const ts = at.toISOString();
    let doc: AgreementDoc;
    try {
      doc = await agreements(req).insertOne({
        _id: agreementId,
        ...content,
        purchasers: mergePurchasers(content.purchasers, []),
        status: AgreementStatus.Draft,
        createdByName: req.principal!.name,
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (err) {
      await proposals(req).updateOne(
        { _id: proposal._id, agreementId },
        { $unset: { agreementId: '' } },
      );
      throw err;
    }
    await setHomeStatus(req, proposal, InventoryStatus.Reserved, at);
    res.status(201).json(toAgreement(doc));
  });

  router.get('/:id', async (req, res) => {
    const doc = await loadFor(req, id(req));
    res.json(toAgreement(doc, signerIdOf(req, doc)));
  });

  router.put('/:id', staffOnly, async (req, res) => {
    const input = parse(agreementUpdateSchema, req.body);
    const current = await loadFor(req, id(req));
    if (!isOpenAgreement(current.status)) throw conflict(ERRORS.agreements.onlyOpenEditable);
    const proposal = await proposals(req).findOne({ _id: current.proposalId });
    if (!proposal) throw notFound(ERRORS.proposals.notFound);
    const at = now();
    const content = await compose(req, proposal, input, current.reference, at, current.purchasers);
    const changed = content.contentHash !== current.contentHash;
    const merged = mergePurchasers(content.purchasers, current.purchasers);
    const { purchasers: next, invalidated } = changed
      ? invalidateSignatures(merged, at)
      : { purchasers: merged, invalidated: 0 };
    const ts = at.toISOString();
    const doc = await agreements(req).findOneAndUpdate(
      { _id: current._id, status: current.status, updatedAt: current.updatedAt },
      {
        $set: {
          ...content,
          purchasers: next,
          ...(invalidated > 0 && { status: AgreementStatus.UnderReview }),
          updatedAt: ts,
        },
        ...(invalidated > 0 && { $unset: { signedAt: '' } }),
      },
    );
    if (!doc) throw conflict(ERRORS.agreements.changedReload);
    if (current.issuedAt && changed) {
      await tellProposal(
        req,
        doc.proposalId,
        THREAD.agreementAmended(req.principal!.name, doc.reference, invalidated),
        at,
      );
    }
    res.json(toAgreement(doc));
  });

  router.post('/:id/issue', staffOnly, async (req, res) => {
    const { contentHash } = parse(agreementIssueSchema, req.body);
    const current = await loadFor(req, id(req));
    if (current.status !== AgreementStatus.Draft) throw conflict(ERRORS.agreements.alreadySent);
    if (current.contentHash !== contentHash) {
      throw conflict(ERRORS.agreements.changedBeforeSending);
    }
    const at = now();
    const ts = at.toISOString();
    const doc = await agreements(req).findOneAndUpdate(
      { _id: current._id, status: AgreementStatus.Draft, contentHash },
      {
        $set: {
          status: AgreementStatus.UnderReview,
          issuedAt: ts,
          issuedByName: req.principal!.name,
          purchasers: current.purchasers.map((p) => ({ ...p, invitedAt: ts })),
          updatedAt: ts,
        },
      },
    );
    if (!doc) throw conflict(ERRORS.agreements.changedReload);
    const invitations = await signatures.invite(
      signatureContext(req, at),
      envelopeOf(doc),
      doc.purchasers.map(signerRef),
    );
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.agreementSent(req.principal!.name, doc.reference),
      at,
    );
    res.json({ agreement: toAgreement(doc), invitations } satisfies AgreementIssued);
  });

  router.post('/:id/purchasers/:purchaserId/invite', staffOnly, async (req, res) => {
    const current = await loadFor(req, id(req));
    const purchaser = current.purchasers.find((p) => p.id === req.params['purchaserId']);
    if (!purchaser) throw notFound(ERRORS.agreements.purchaserNotFound);
    if (!current.issuedAt) throw conflict(ERRORS.agreements.notIssued);
    if (current.status === AgreementStatus.Cancelled)
      throw conflict(ERRORS.agreements.alreadyCancelled);
    const at = now();
    const [invitation] = await signatures.invite(signatureContext(req, at), envelopeOf(current), [
      signerRef(purchaser),
    ]);
    res.status(201).json(invitation satisfies SignerInvitation | undefined);
  });

  router.post('/:id/sign', signerOnly, async (req, res) => {
    const input = parse(agreementSignSchema, req.body);
    const current = await loadFor(req, id(req));
    const signerId = signerIdOf(req, current);
    const purchaser = current.purchasers.find((p) => p.id === signerId);
    if (!signerId || !purchaser) throw forbidden(ERRORS.agreements.notASigner);
    if (current.status !== AgreementStatus.UnderReview)
      throw conflict(ERRORS.agreements.notOpenForSignature);
    if (purchaser.status === SignerStatus.Signed) throw conflict(ERRORS.agreements.alreadySigned);
    if (current.contentHash !== input.contentHash) {
      throw conflict(ERRORS.agreements.changedBeforeSigning);
    }
    if (keyClauses(current.sections).some((clause) => !input.initials.includes(clause))) {
      throw unprocessable(ERRORS.agreements.initialsRequired);
    }

    const at = now();
    const ts = at.toISOString();
    const signature = await signatures.capture(
      signatureContext(req, at),
      envelopeOf(current),
      signerRef(purchaser),
      {
        fullName: input.fullName,
        initials: input.initials,
        contentHash: input.contentHash,
        ...(req.ip && { ip: req.ip }),
      },
    );
    const { invalidatedAt: _previous, ...identity } = purchaser;
    const purchasers = current.purchasers.map((p) =>
      p.id === purchaser.id ? { ...identity, status: SignerStatus.Signed, signature } : p,
    );
    const everyone = allSigned(purchasers);
    const doc = await agreements(req).findOneAndUpdate(
      {
        _id: current._id,
        status: AgreementStatus.UnderReview,
        contentHash: input.contentHash,
        updatedAt: current.updatedAt,
      },
      {
        $set: {
          purchasers,
          ...(everyone && { status: AgreementStatus.Signed, signedAt: ts }),
          updatedAt: ts,
        },
      },
    );
    if (!doc) throw conflict(ERRORS.agreements.changedMeanwhileBeforeSigning);
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.agreementSigned(
        input.fullName,
        doc.reference,
        signedCount(purchasers),
        purchasers.length,
      ),
      at,
    );
    if (everyone) {
      await tellProposal(req, doc.proposalId, THREAD.agreementAllSigned(doc.reference), at);
    }
    res.json(toAgreement(doc, signerId));
  });

  router.post('/:id/countersign', countersignerOnly, async (req, res) => {
    const input = parse(agreementCountersignSchema, req.body);
    const current = await loadFor(req, id(req));
    if (current.status === AgreementStatus.Executed)
      throw conflict(ERRORS.agreements.alreadyExecuted);
    if (current.status !== AgreementStatus.Signed) {
      throw conflict(ERRORS.agreements.waitingForPurchasers);
    }
    if (current.contentHash !== input.contentHash) {
      throw conflict(ERRORS.agreements.changedBeforeSigning);
    }
    const at = now();
    const ts = at.toISOString();
    const counterSignature = await signatures.capture(
      signatureContext(req, at),
      envelopeOf(current),
      { id: req.principal!.sub, name: req.principal!.name },
      {
        fullName: input.fullName,
        initials: [],
        contentHash: input.contentHash,
        ...(req.ip && { ip: req.ip }),
      },
    );

    const executed = { ...current, status: AgreementStatus.Executed, counterSignature };
    const pdf = await renderAgreementPdf(
      toAgreement({ ...executed, executedAt: ts, updatedAt: ts }),
    );
    const executedPdf = { fileId: newId(), sha256: sha256(pdf), size: pdf.length };
    await files(req).insertOne({
      _id: executedPdf.fileId,
      agreementId: current._id,
      kind: 'executed',
      contentType: 'application/pdf',
      data: pdf,
      sha256: executedPdf.sha256,
      size: executedPdf.size,
      createdAt: ts,
    });
    const doc = await agreements(req).findOneAndUpdate(
      { _id: current._id, status: AgreementStatus.Signed, contentHash: input.contentHash },
      {
        $set: {
          status: AgreementStatus.Executed,
          counterSignature,
          executedAt: ts,
          executedPdf,
          updatedAt: ts,
        },
      },
    );
    if (!doc) {
      await files(req).deleteOne({ _id: executedPdf.fileId });
      throw conflict(ERRORS.agreements.changedReload);
    }
    const proposal = await proposals(req).findOne({ _id: doc.proposalId });
    await setHomeStatus(req, proposal, InventoryStatus.Sold, at);
    await signatures.revoke(signatureContext(req, at), envelopeOf(doc));
    await tellProposal(
      req,
      doc.proposalId,
      THREAD.agreementExecuted(input.fullName, doc.reference),
      at,
    );
    res.json(toAgreement(doc));
  });

  router.post('/:id/cancel', staffOnly, async (req, res) => {
    const { reason } = parse(agreementCancelSchema, req.body);
    const current = await loadFor(req, id(req));
    if (current.status === AgreementStatus.Executed)
      throw conflict(ERRORS.agreements.executedCannotCancel);
    if (current.status === AgreementStatus.Cancelled)
      throw conflict(ERRORS.agreements.alreadyCancelled);
    if (req.principal!.role !== Role.CompanyAdmin) {
      const held = await heldFor(req.repo, current._id);
      if (held > 0) {
        throw forbidden(ERRORS.payments.cancelHoldsMoney(formatMoney(held, current.currency)));
      }
    }
    const at = now();
    const doc = await voidAgreement(req.repo, current, at, {
      reason,
      byName: req.principal!.name,
    });
    if (!doc) throw conflict(ERRORS.agreements.changedReload);
    await proposals(req).updateOne(
      { _id: doc.proposalId, agreementId: doc._id },
      { $unset: { agreementId: '' } },
    );
    await signatures.revoke(signatureContext(req, at), envelopeOf(doc));
    if (doc.issuedAt) {
      await tellProposal(
        req,
        doc.proposalId,
        THREAD.agreementCancelled(req.principal!.name, doc.reference, reason),
        at,
      );
    }
    res.json(toAgreement(doc));
  });

  router.get('/:id/pdf', async (req, res) => {
    const doc = await loadFor(req, id(req));
    let pdf: Buffer | undefined;
    if (doc.executedPdf) {
      const file = await files(req).findOne({
        _id: doc.executedPdf.fileId,
        agreementId: doc._id,
      });
      if (file) pdf = fileBytes(file.data);
    }
    pdf ??= await renderAgreementPdf(toAgreement(doc));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${agreementFileName(doc.reference, doc.status)}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    });
    res.end(pdf);
  });

  return router;
};
