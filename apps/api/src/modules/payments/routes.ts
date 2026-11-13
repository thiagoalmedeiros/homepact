import {
  AccessResourceType,
  AgreementStatus,
  COMPANY_ROLES,
  formatMoney,
  GuestRole,
  isPayableAgreement,
  isPaymentManager,
  isRefundableAgreement,
  isoDay,
  Party,
  PAYMENT_MANAGER_ROLES,
  PaymentAction,
  paymentCreateSchema,
  PaymentKind,
  paymentQueueQuerySchema,
  paymentReasonSchema,
  PaymentStatus,
  paymentUpdateSchema,
  receiptFileName,
  type AgreementLedger,
  type BuyerLedger,
  type CompanyRole,
  type PaymentActor,
  type PaymentEvent,
} from '@homepact/shared';
import { Router, type Request } from 'express';
import { isCompanyMember } from '../../auth/require-auth.js';
import type { ModuleContext } from '../../context.js';
import { newId, reference } from '../../data/ids.js';
import {
  conflict,
  forbidden,
  HttpError,
  notFound,
  parse,
  unprocessable,
} from '../../http/errors.js';
import { ERRORS, NAMES, THREAD } from '../../messages.js';
import type { AgreementDoc } from '../agreements/store.js';
import { addMessage, loadProposalFor, type ProposalDoc } from '../proposals/store.js';
import { renderReceiptPdf } from './receipt.js';
import {
  ledgerOf,
  LIVE_STATUSES,
  paymentsOf,
  scheduleOf,
  toBuyerPayment,
  toPayment,
  totalOf,
  type PaymentDoc,
} from './store.js';

const sameRef = (a?: string, b?: string) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** An agreement's ledger at `/agreements/:agreementId/payments`. Finance and administrators post
 * at once; sales entries wait for their approval. Entries are voided, never deleted; buyers see
 * posted ones. */
export const agreementPaymentRoutes = (ctx: ModuleContext): Router => {
  const { guards, now } = ctx;
  const router = Router({ mergeParams: true });
  const companyOnly = guards.requireRole(...COMPANY_ROLES);
  const managersOnly = guards.requireRole(...PAYMENT_MANAGER_ROLES);
  router.use(guards.requireAuth);

  const agreementIdOf = (req: Request) => req.params['agreementId'] as string;
  const paymentIdOf = (req: Request) => req.params['paymentId'] as string;
  const actorOf = (req: Request): PaymentActor => ({
    id: req.principal!.sub,
    name: req.principal!.name,
    role: req.principal!.role as CompanyRole,
  });
  const event = (req: Request, at: Date, action: PaymentAction, reason?: string): PaymentEvent => ({
    at: at.toISOString(),
    by: actorOf(req),
    action,
    ...(reason && { reason }),
  });
  const money = (cents: number, agreement: AgreementDoc) => formatMoney(cents, agreement.currency);

  const loadAgreement = async (req: Request): Promise<AgreementDoc> => {
    const doc = await req.repo.of<AgreementDoc>('agreements').findOne({ _id: agreementIdOf(req) });
    if (!doc) throw notFound(ERRORS.payments.agreementNotFound);
    return doc;
  };

  /** The agreement, if the caller is its buyer (with an account or the proposal's invite link). */
  const loadAgreementForBuyer = async (req: Request): Promise<AgreementDoc> => {
    const p = req.principal!;
    if (p.role === GuestRole.KeyHolder && p.resource?.type === AccessResourceType.Agreement) {
      throw forbidden(ERRORS.payments.signingLinkOnly);
    }
    const doc = await loadAgreement(req);
    if (!doc.issuedAt) throw notFound(ERRORS.payments.agreementNotFound);
    await loadProposalFor(req, doc.proposalId);
    return doc;
  };

  const loadPayment = async (req: Request, agreement: AgreementDoc): Promise<PaymentDoc> => {
    const doc = await paymentsOf(req.repo).findOne({
      _id: paymentIdOf(req),
      agreementId: agreement._id,
    });
    if (!doc) throw notFound(ERRORS.payments.notFound);
    return doc;
  };

  const liveLedger = async (req: Request, agreement: AgreementDoc, except?: string) =>
    (await ledgerOf(req.repo, agreement._id)).filter(
      (e) => e._id !== except && (LIVE_STATUSES as readonly PaymentStatus[]).includes(e.status),
    );

  const assertNotFuture = (receivedOn: string, at: Date) => {
    if (receivedOn > isoDay(at)) throw unprocessable(ERRORS.payments.futureDate);
  };

  /** Posted and pending payments, less refunds, plus this one, may not pass the price. */
  const assertWithinPrice = (
    agreement: AgreementDoc,
    ledger: PaymentDoc[],
    amountCents: number,
    countPending: boolean,
  ) => {
    const committed =
      totalOf(ledger, PaymentKind.Payment, PaymentStatus.Posted) -
      totalOf(ledger, PaymentKind.Refund, PaymentStatus.Posted) +
      (countPending ? totalOf(ledger, PaymentKind.Payment, PaymentStatus.Pending) : 0);
    const left = agreement.quote.totalCents - committed;
    if (amountCents > left) {
      throw unprocessable(
        ERRORS.payments.aboveBalance(money(Math.max(0, left), agreement), countPending),
      );
    }
  };

  const assertNoDuplicate = (
    ledger: PaymentDoc[],
    entry: { kind: PaymentKind; amountCents: number; receivedOn: string; externalRef?: string },
  ) => {
    const twin = ledger.find(
      (e) =>
        e.kind === entry.kind &&
        e.amountCents === entry.amountCents &&
        e.receivedOn === entry.receivedOn &&
        sameRef(e.externalRef, entry.externalRef),
    );
    if (twin) {
      throw new HttpError(409, ERRORS.payments.duplicate, { duplicateOf: [twin.reference] });
    }
  };

  /** Posted entries are announced on the proposal thread, which the buyer reads. */
  const tellBuyer = async (agreement: AgreementDoc, payment: PaymentDoc, req: Request) => {
    const at = now();
    const amount = money(payment.amountCents, agreement);
    const body =
      payment.kind === PaymentKind.Refund
        ? THREAD.refundIssued(amount, agreement.reference, payment.receivedOn)
        : THREAD.paymentReceived(amount, agreement.reference, payment.receivedOn);
    await addMessage(req.repo, agreement.proposalId, Party.System, NAMES.system, body, at);
    await req.repo
      .of<ProposalDoc>('proposals')
      .updateOne(
        { _id: agreement.proposalId },
        { $set: { lastActivityAt: at.toISOString(), updatedAt: at.toISOString() } },
      );
  };

  /** The agreement for a reader: anyone in the company, or its buyer. */
  const loadReadable = async (req: Request) =>
    isCompanyMember(req.principal)
      ? { agreement: await loadAgreement(req), company: true }
      : { agreement: await loadAgreementForBuyer(req), company: false };

  router.get('/', async (req, res) => {
    const today = isoDay(now());
    const { agreement, company } = await loadReadable(req);
    if (company) {
      const entries = await ledgerOf(req.repo, agreement._id);
      res.json({
        agreementId: agreement._id,
        agreementReference: agreement.reference,
        agreementStatus: agreement.status,
        currency: agreement.currency,
        schedule: scheduleOf(agreement, entries, today),
        payments: entries.map(toPayment),
      } satisfies AgreementLedger);
      return;
    }
    const posted = (await ledgerOf(req.repo, agreement._id)).filter(
      (e) => e.status === PaymentStatus.Posted,
    );
    res.json({
      agreementId: agreement._id,
      agreementReference: agreement.reference,
      currency: agreement.currency,
      schedule: scheduleOf(agreement, posted, today),
      payments: posted.map(toBuyerPayment),
    } satisfies BuyerLedger);
  });

  router.get('/:paymentId/receipt', async (req, res) => {
    const { agreement } = await loadReadable(req);
    const payment = await loadPayment(req, agreement);
    if (payment.status !== PaymentStatus.Posted) throw notFound(ERRORS.payments.noReceipt);
    const pdf = await renderReceiptPdf({ agreement, payment });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${receiptFileName(payment.reference)}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    });
    res.end(pdf);
  });

  router.post('/', companyOnly, async (req, res) => {
    const input = parse(paymentCreateSchema, req.body);
    const agreement = await loadAgreement(req);
    const manager = isPaymentManager(req.principal!.role);
    const at = now();
    assertNotFuture(input.receivedOn, at);
    const ledger = await liveLedger(req, agreement);

    if (input.kind === PaymentKind.Refund) {
      if (!manager) throw forbidden(ERRORS.payments.refundsAreFinance);
      if (!isRefundableAgreement(agreement.status)) throw conflict(ERRORS.payments.notRefundable);
      const held =
        totalOf(ledger, PaymentKind.Payment, PaymentStatus.Posted) -
        totalOf(ledger, PaymentKind.Refund, PaymentStatus.Posted);
      if (input.amountCents > held) {
        throw unprocessable(ERRORS.payments.refundAboveHeld(money(held, agreement)));
      }
    } else {
      if (!isPayableAgreement(agreement.status)) {
        throw conflict(
          agreement.status === AgreementStatus.Cancelled
            ? ERRORS.payments.agreementCancelled
            : ERRORS.payments.agreementNotSigned,
        );
      }
      assertWithinPrice(agreement, ledger, input.amountCents, true);
    }
    if (!input.allowDuplicate) assertNoDuplicate(ledger, input);

    const paymentId = newId();
    const ts = at.toISOString();
    if (input.replacesId) {
      const replaced = await paymentsOf(req.repo).findOne({
        _id: input.replacesId,
        agreementId: agreement._id,
      });
      if (
        !replaced ||
        replaced.kind !== input.kind ||
        ![PaymentStatus.Voided, PaymentStatus.Rejected].includes(replaced.status)
      ) {
        throw unprocessable(ERRORS.payments.replacesOnlyClosed);
      }
      const claimed = await paymentsOf(req.repo).findOneAndUpdate(
        { _id: replaced._id, replacedById: { $exists: false } },
        { $set: { replacedById: paymentId, updatedAt: ts } },
      );
      if (!claimed) throw conflict(ERRORS.payments.alreadyReplaced);
    }

    let doc: PaymentDoc;
    try {
      doc = await paymentsOf(req.repo).insertOne({
        _id: paymentId,
        reference: reference('PAY'),
        agreementId: agreement._id,
        agreementReference: agreement.reference,
        kind: input.kind,
        status: manager ? PaymentStatus.Posted : PaymentStatus.Pending,
        amountCents: input.amountCents,
        currency: agreement.currency,
        receivedOn: input.receivedOn,
        method: input.method,
        ...(input.externalRef && { externalRef: input.externalRef }),
        ...(input.note && { note: input.note }),
        ...(input.replacesId && { replacesId: input.replacesId }),
        recordedBy: actorOf(req),
        recordedAt: ts,
        history: [event(req, at, PaymentAction.Recorded)],
        updatedAt: ts,
      });
    } catch (err) {
      if (input.replacesId) {
        await paymentsOf(req.repo).updateOne(
          { _id: input.replacesId, replacedById: paymentId },
          { $unset: { replacedById: '' } },
        );
      }
      throw err;
    }
    if (doc.status === PaymentStatus.Posted) await tellBuyer(agreement, doc, req);
    res.status(201).json(toPayment(doc));
  });

  router.put('/:paymentId', companyOnly, async (req, res) => {
    const input = parse(paymentUpdateSchema, req.body);
    const agreement = await loadAgreement(req);
    const current = await loadPayment(req, agreement);
    if (current.recordedBy.id !== req.principal!.sub) throw forbidden(ERRORS.payments.onlyAuthor);
    if (current.status !== PaymentStatus.Pending) throw conflict(ERRORS.payments.notPending);
    const at = now();
    assertNotFuture(input.receivedOn, at);
    const ledger = await liveLedger(req, agreement, current._id);
    assertWithinPrice(agreement, ledger, input.amountCents, true);
    if (!input.allowDuplicate) assertNoDuplicate(ledger, { ...input, kind: current.kind });

    const ts = at.toISOString();
    const cleared = {
      ...(!input.externalRef && { externalRef: '' as const }),
      ...(!input.note && { note: '' as const }),
    };
    const doc = await paymentsOf(req.repo).findOneAndUpdate(
      { _id: current._id, status: PaymentStatus.Pending, updatedAt: current.updatedAt },
      {
        $set: {
          amountCents: input.amountCents,
          receivedOn: input.receivedOn,
          method: input.method,
          ...(input.externalRef && { externalRef: input.externalRef }),
          ...(input.note && { note: input.note }),
          history: [...current.history, event(req, at, PaymentAction.Edited)],
          updatedAt: ts,
        },
        ...(Object.keys(cleared).length && { $unset: cleared }),
      },
    );
    if (!doc) throw conflict(ERRORS.payments.changedReload);
    res.json(toPayment(doc));
  });

  /** Moves an entry on from the state it was read in; fails if it changed meanwhile. */
  const transition = async (
    req: Request,
    current: PaymentDoc,
    set: Partial<PaymentDoc>,
    happened: PaymentEvent,
  ): Promise<PaymentDoc> => {
    const doc = await paymentsOf(req.repo).findOneAndUpdate(
      { _id: current._id, status: current.status, updatedAt: current.updatedAt },
      { $set: { ...set, history: [...current.history, happened], updatedAt: happened.at } },
    );
    if (!doc) throw conflict(ERRORS.payments.changedReload);
    return doc;
  };

  router.post('/:paymentId/approve', managersOnly, async (req, res) => {
    const agreement = await loadAgreement(req);
    const current = await loadPayment(req, agreement);
    if (current.status !== PaymentStatus.Pending) throw conflict(ERRORS.payments.notPending);
    if (current.recordedBy.id === req.principal!.sub) {
      throw forbidden(ERRORS.payments.cannotApproveOwn);
    }
    const ledger = await liveLedger(req, agreement, current._id);
    assertWithinPrice(agreement, ledger, current.amountCents, false);
    const at = now();
    const doc = await transition(
      req,
      current,
      { status: PaymentStatus.Posted, reviewedBy: actorOf(req), reviewedAt: at.toISOString() },
      event(req, at, PaymentAction.Approved),
    );
    await tellBuyer(agreement, doc, req);
    res.json(toPayment(doc));
  });

  router.post('/:paymentId/reject', managersOnly, async (req, res) => {
    const { reason } = parse(paymentReasonSchema, req.body);
    const agreement = await loadAgreement(req);
    const current = await loadPayment(req, agreement);
    if (current.status !== PaymentStatus.Pending) throw conflict(ERRORS.payments.notPending);
    const at = now();
    const doc = await transition(
      req,
      current,
      {
        status: PaymentStatus.Rejected,
        reviewedBy: actorOf(req),
        reviewedAt: at.toISOString(),
        rejectReason: reason,
      },
      event(req, at, PaymentAction.Rejected, reason),
    );
    res.json(toPayment(doc));
  });

  router.post('/:paymentId/withdraw', companyOnly, async (req, res) => {
    const agreement = await loadAgreement(req);
    const current = await loadPayment(req, agreement);
    if (current.recordedBy.id !== req.principal!.sub) throw forbidden(ERRORS.payments.onlyAuthor);
    if (current.status !== PaymentStatus.Pending) throw conflict(ERRORS.payments.notPending);
    const at = now();
    const doc = await transition(
      req,
      current,
      { status: PaymentStatus.Withdrawn },
      event(req, at, PaymentAction.Withdrawn),
    );
    res.json(toPayment(doc));
  });

  router.post('/:paymentId/void', managersOnly, async (req, res) => {
    const { reason } = parse(paymentReasonSchema, req.body);
    const agreement = await loadAgreement(req);
    const current = await loadPayment(req, agreement);
    if (current.status !== PaymentStatus.Posted) throw conflict(ERRORS.payments.notPosted);
    if (current.kind === PaymentKind.Payment) {
      const ledger = await liveLedger(req, agreement, current._id);
      if (
        totalOf(ledger, PaymentKind.Refund, PaymentStatus.Posted) >
        totalOf(ledger, PaymentKind.Payment, PaymentStatus.Posted)
      ) {
        throw conflict(ERRORS.payments.voidRefundFirst);
      }
    }
    const at = now();
    const doc = await transition(
      req,
      current,
      {
        status: PaymentStatus.Voided,
        voidedBy: actorOf(req),
        voidedAt: at.toISOString(),
        voidReason: reason,
      },
      event(req, at, PaymentAction.Voided, reason),
    );
    res.json(toPayment(doc));
  });

  return router;
};

/** The company's entries by status at `/agreement-payments` (pending by default: the approval
 * queue). Sales see only the ones they recorded. */
export const paymentQueueRoutes = ({ guards }: ModuleContext): Router => {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole(...COMPANY_ROLES));

  router.get('/', async (req, res) => {
    const q = parse(paymentQueueQuerySchema, req.query);
    const docs = await paymentsOf(req.repo).find(
      {
        status: q.status,
        ...(q.agreementId && { agreementId: q.agreementId }),
        ...(!isPaymentManager(req.principal!.role) && { 'recordedBy.id': req.principal!.sub }),
      },
      { sort: { recordedAt: 1 }, limit: 300 },
    );
    res.json(docs.map(toPayment));
  });

  return router;
};
