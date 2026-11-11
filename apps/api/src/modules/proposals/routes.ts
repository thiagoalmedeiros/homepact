import {
  AccessResourceType,
  ACTIVE_PROPOSAL_STATUSES,
  AgreementStatus,
  applyChanges,
  assignRepSchema,
  ChangeDecision,
  ChangeError,
  changePreviewSchema,
  changeRequestCreateSchema,
  ChangeRequestStatus,
  decisionSchema,
  formatMoney,
  GuestRole,
  InventoryStatus,
  isActiveProposal,
  lockSchema,
  messageCreateSchema,
  Party,
  priceBeforeTax,
  proposalCreateSchema,
  proposalListQuerySchema,
  proposalQuoteSchema,
  ProposalStatus,
  revisionCreateSchema,
  Role,
  signSchema,
  STAFF_ROLES,
  type Adjustment,
  type Catalog,
  type Change,
  type ChangePreview,
  type ProposalCreated,
  type QuoteExtras,
  type QuoteSnapshot,
  type RequestedChange,
  type Selections,
} from '@homepact/shared';
import { Router, type Request } from 'express';
import type { Filter } from 'mongodb';
import type { z } from 'zod';
import { isStaff } from '../../auth/require-auth.js';
import type { ModuleContext } from '../../context.js';
import { newId, reference } from '../../data/ids.js';
import { conflict, forbidden, notFound, parse, unprocessable } from '../../http/errors.js';
import { createAccessKey } from '../access-keys/keys.js';
import type { UserDoc } from '../auth/users.js';
import {
  askingPriceAdjustment,
  loadHouse,
  price,
  pricingContext,
  pricingExtras,
  type PricingContext,
} from '../houses/pricing.js';
import { toDetail, type HouseDoc } from '../houses/store.js';
import { voidAgreement, type AgreementDoc } from '../agreements/store.js';
import type { InventoryHomeDoc } from '../inventory/store.js';
import { applyReferral } from '../referrals/store.js';
import { carriedTaxRate, resolveTaxRate } from '../sales-tax/store.js';
import {
  addMessage,
  authorName,
  describeChange,
  packageContents,
  loadDetail,
  loadProposalFor,
  partyOf,
  toProposal,
  type ChangeRequestDoc,
  type ProposalDoc,
  type RevisionDoc,
} from './store.js';
import { ERRORS, NAMES, THREAD } from '../../messages.js';

const money = (q: QuoteSnapshot) => formatMoney(q.totalCents, q.currency);

const applyOrThrow = (selections: Selections, changes: Change[], catalog: Catalog): Selections => {
  try {
    return applyChanges(selections, changes, packageContents(catalog));
  } catch (err) {
    if (err instanceof ChangeError) throw unprocessable(err.message);
    throw err;
  }
};

/** The negotiation. Province and referral carry over unless changed; changes are priced alone,
 * before tax; re-pricing a signed proposal voids its agreement; signing holds a pre-existing
 * home. */
export const proposalRoutes = (ctx: ModuleContext): Router => {
  const { guards, now } = ctx;
  const router = Router();
  const staffOnly = guards.requireRole(...STAFF_ROLES);
  const buyerOnly = guards.requireRole(Role.Buyer, GuestRole.KeyHolder);
  router.use(guards.requireAuth);

  const proposals = (req: Request) => req.repo.of<ProposalDoc>('proposals');
  const revisions = (req: Request) => req.repo.of<RevisionDoc>('revisions');
  const changeRequests = (req: Request) => req.repo.of<ChangeRequestDoc>('changeRequests');
  const id = (req: Request) => req.params['id'] as string;

  const liveAgreement = async (req: Request, agreementId: string): Promise<AgreementDoc | null> => {
    const doc = await req.repo.of<AgreementDoc>('agreements').findOne({ _id: agreementId });
    if (doc?.status === AgreementStatus.Executed)
      throw conflict(ERRORS.proposals.agreementExecuted);
    return doc;
  };

  const currentRevision = async (req: Request, p: ProposalDoc): Promise<RevisionDoc> => {
    const rev = await revisions(req).findOne({ proposalId: p._id, number: p.currentRevision });
    if (!rev) throw notFound(ERRORS.proposals.revisionNotFound);
    return rev;
  };

  const touch = (at: Date) => ({ lastActivityAt: at.toISOString(), updatedAt: at.toISOString() });

  const carriedExtras = async (req: Request, base: RevisionDoc): Promise<QuoteExtras> => ({
    tax: await carriedTaxRate(req.repo, base.quote.tax),
    referral: base.quote.referral ?? null,
  });

  const previewChanges = (
    house: HouseDoc,
    pc: PricingContext,
    base: RevisionDoc,
    changes: Change[],
    extras: QuoteExtras,
    adjustments = base.quote.adjustments,
  ): { quote: QuoteSnapshot; items: Omit<RequestedChange, 'id'>[] } => {
    const quote = price(
      house,
      pc,
      applyOrThrow(base.selections, changes, pc.catalog),
      adjustments,
      extras,
    );
    const priceOfChangeAlone = (change: Change): number => {
      try {
        const alone = price(
          house,
          pc,
          applyChanges(base.selections, [change], packageContents(pc.catalog)),
          base.quote.adjustments,
          extras,
        );
        return priceBeforeTax(alone) - priceBeforeTax(base.quote);
      } catch {
        return 0;
      }
    };
    const items = changes.map((change) => ({
      change,
      label: describeChange(change, base.selections, pc.catalog),
      deltaCents: priceOfChangeAlone(change),
    }));
    return { quote, items };
  };

  const priceNew = async (req: Request, input: z.output<typeof proposalQuoteSchema>) => {
    const [pc, extras] = await Promise.all([pricingContext(ctx, req), pricingExtras(req, input)]);
    let house: HouseDoc;
    let selections: Selections;
    let adjustments: Adjustment[];
    let inventory: InventoryHomeDoc | null = null;
    if (input.inventoryHomeId) {
      inventory = await req.repo
        .of<InventoryHomeDoc>('inventoryHomes')
        .findOne({ _id: input.inventoryHomeId });
      if (!inventory) throw notFound(ERRORS.proposals.homeNotFound);
      if (inventory.status === InventoryStatus.Sold) throw conflict(ERRORS.proposals.homeSold);
      house = await loadHouse(req, inventory.houseId);
      selections = inventory.selections;
      const configured = price(house, pc, selections);
      adjustments = [
        ...askingPriceAdjustment(configured, inventory.priceCents),
        ...input.adjustments,
      ];
    } else {
      house = await loadHouse(req, input.houseId!);
      selections = input.selections;
      adjustments = input.adjustments;
    }
    return {
      house,
      inventory,
      selections,
      quote: price(house, pc, selections, adjustments, extras),
    };
  };

  router.post('/quote', staffOnly, async (req, res) => {
    const input = parse(proposalQuoteSchema, req.body);
    res.json((await priceNew(req, input)).quote);
  });

  router.post('/', staffOnly, async (req, res) => {
    const input = parse(proposalCreateSchema, req.body);
    if (input.houseId && input.locked) throw unprocessable(ERRORS.proposals.onlyHomesLock);
    const { house, inventory, selections, quote } = await priceNew(req, input);

    const at = now();
    const ts = at.toISOString();
    const proposalId = newId();
    const { key, doc: keyDoc } = await createAccessKey(
      req.repo,
      AccessResourceType.Proposal,
      proposalId,
      { createdBy: req.principal!.sub, now: at },
    );
    const imageUrl = inventory?.images[0] ?? house.images[0];
    const doc = await proposals(req).insertOne({
      _id: proposalId,
      reference: reference('P'),
      kind: inventory ? 'inventory' : 'plan',
      houseId: house._id,
      houseName: house.name,
      ...(imageUrl && { imageUrl }),
      ...(inventory && {
        inventoryHomeId: inventory._id,
        address: inventory.address,
        community: inventory.community,
      }),
      locked: inventory ? (input.locked ?? inventory.lockedByDefault) : false,
      buyer: input.buyer,
      repId: req.principal!.sub,
      repName: req.principal!.name,
      status: ProposalStatus.Proposed,
      currentRevision: 1,
      currentTotalCents: quote.totalCents,
      currency: quote.currency,
      accessKeyId: keyDoc._id,
      createdAt: ts,
      ...touch(at),
    });
    await revisions(req).insertOne({
      _id: newId(),
      proposalId,
      number: 1,
      selections,
      quote,
      authorName: req.principal!.name,
      createdAt: ts,
      ...(input.note && { note: input.note }),
    });
    await addMessage(
      req.repo,
      proposalId,
      Party.System,
      NAMES.system,
      THREAD.proposed(req.principal!.name, house.name, inventory?.address, money(quote)),
      at,
    );
    if (input.note)
      await addMessage(req.repo, proposalId, Party.Seller, req.principal!.name, input.note, at);
    res.status(201).json({ proposal: toProposal(doc), accessKey: key } satisfies ProposalCreated);
  });

  router.get('/', async (req, res) => {
    const p = req.principal!;
    const q = parse(proposalListQuerySchema, req.query);
    let filter: Filter<ProposalDoc>;
    if (isStaff(p)) {
      filter = { ...(q.status && { status: q.status }), ...(q.mine === '1' && { repId: p.sub }) };
    } else if (p.role === Role.Buyer) {
      filter = { buyerUserId: p.sub };
    } else if (p.resource?.type === AccessResourceType.Proposal) {
      filter = { _id: p.resource.id };
    } else {
      res.json([]);
      return;
    }
    const docs = await proposals(req).find(filter, { sort: { lastActivityAt: -1 }, limit: 300 });
    res.json(docs.map(toProposal));
  });

  router.get('/:id', async (req, res) => {
    res.json(await loadDetail(req, await loadProposalFor(req, id(req))));
  });

  router.get('/:id/options', async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const pc = await pricingContext(ctx, req);
    res.json(toDetail(await loadHouse(req, p.houseId), pc.catalog, pc.currency));
  });

  router.post('/:id/messages', async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const { body } = parse(messageCreateSchema, req.body);
    const at = now();
    await addMessage(req.repo, p._id, partyOf(req), authorName(req, p), body, at);
    const updated = await proposals(req).findOneAndUpdate({ _id: p._id }, { $set: touch(at) });
    res.status(201).json(await loadDetail(req, updated!));
  });

  const priceRevision = async (
    req: Request,
    p: ProposalDoc,
    input: z.output<typeof revisionCreateSchema>,
  ): Promise<QuoteSnapshot> => {
    const base = await currentRevision(req, p);
    const [house, pc, tax, referral] = await Promise.all([
      loadHouse(req, p.houseId),
      pricingContext(ctx, req),
      input.taxRegion === undefined
        ? carriedTaxRate(req.repo, base.quote.tax)
        : resolveTaxRate(req.repo, input.taxRegion, base.quote.tax),
      input.referral === undefined
        ? (base.quote.referral ?? null)
        : input.referral && applyReferral(req.repo, input.referral, base.quote.referral),
    ]);
    return price(house, pc, input.selections, input.adjustments, { tax, referral });
  };

  router.post('/:id/revisions/preview', staffOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const input = parse(revisionCreateSchema, req.body);
    res.json(await priceRevision(req, p, input));
  });

  router.post('/:id/revisions', staffOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    if (p.status === ProposalStatus.ChangesRequested)
      throw conflict(ERRORS.proposals.answerRequestFirst);
    const repricing = p.status === ProposalStatus.Signed;
    if (!repricing && p.status !== ProposalStatus.Proposed) throw conflict(ERRORS.proposals.closed);
    const live = repricing && p.agreementId ? await liveAgreement(req, p.agreementId) : null;
    const input = parse(revisionCreateSchema, req.body);
    const quote = await priceRevision(req, p, input);
    const at = now();
    const number = p.currentRevision + 1;
    const claimed = await proposals(req).findOneAndUpdate(
      {
        _id: p._id,
        status: repricing ? ProposalStatus.Signed : ProposalStatus.Proposed,
        currentRevision: p.currentRevision,
      },
      {
        $set: {
          status: ProposalStatus.Proposed,
          currentRevision: number,
          currentTotalCents: quote.totalCents,
          ...touch(at),
        },
        ...(repricing && { $unset: { signature: '', agreementId: '' } }),
      },
    );
    if (!claimed) throw conflict(ERRORS.proposals.changedReload);
    if (live) {
      await voidAgreement(req.repo, live, at, { reason: ERRORS.agreements.priceChanged });
      await ctx.signatures.revoke(
        { repo: req.repo, now: at, actorId: req.principal!.sub },
        { agreementId: live._id },
      );
      if (p.inventoryHomeId) {
        await req.repo
          .of<InventoryHomeDoc>('inventoryHomes')
          .updateOne(
            { _id: p.inventoryHomeId, status: { $ne: InventoryStatus.Sold } },
            { $set: { status: InventoryStatus.Available, updatedAt: at.toISOString() } },
          );
      }
      await addMessage(
        req.repo,
        p._id,
        Party.System,
        NAMES.system,
        THREAD.agreementVoidedByPrice(live.reference, money(quote)),
        at,
      );
    }
    await revisions(req).insertOne({
      _id: newId(),
      proposalId: p._id,
      number,
      selections: input.selections,
      quote,
      authorName: req.principal!.name,
      createdAt: at.toISOString(),
      ...(input.note && { note: input.note }),
    });
    await addMessage(
      req.repo,
      p._id,
      Party.System,
      NAMES.system,
      THREAD.revisionSent(req.principal!.name, number, money(quote)),
      at,
    );
    if (input.note)
      await addMessage(req.repo, p._id, Party.Seller, req.principal!.name, input.note, at);
    res.status(201).json(await loadDetail(req, claimed));
  });

  router.post('/:id/lock', staffOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const { locked } = parse(lockSchema, req.body);
    if (p.kind !== 'inventory') throw unprocessable(ERRORS.proposals.onlyHomesLock);
    if (locked && p.status === ProposalStatus.ChangesRequested)
      throw conflict(ERRORS.proposals.answerOpenRequestFirst);
    if (!isActiveProposal(p.status)) throw conflict(ERRORS.proposals.closed);
    const at = now();
    const updated = await proposals(req).findOneAndUpdate(
      { _id: p._id },
      { $set: { locked, ...touch(at) } },
    );
    await addMessage(
      req.repo,
      p._id,
      Party.System,
      NAMES.system,
      locked ? THREAD.locked : THREAD.unlocked,
      at,
    );
    res.json(await loadDetail(req, updated!));
  });

  router.post('/:id/assign', staffOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const { repId } = parse(assignRepSchema, req.body);
    const rep = await req.repo.of<UserDoc>('users').findOne({
      _id: repId,
      active: true,
      role: { $in: [...STAFF_ROLES] },
    });
    if (!rep) throw unprocessable(ERRORS.proposals.repNotFound);
    const at = now();
    const updated = await proposals(req).findOneAndUpdate(
      { _id: p._id },
      { $set: { repId: rep._id, repName: rep.name, updatedAt: at.toISOString() } },
    );
    await addMessage(req.repo, p._id, Party.System, NAMES.system, THREAD.repAssigned(rep.name), at);
    res.json(await loadDetail(req, updated!));
  });

  router.post('/:id/withdraw', staffOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const at = now();
    const updated = await proposals(req).findOneAndUpdate(
      { _id: p._id, status: { $in: [...ACTIVE_PROPOSAL_STATUSES] } },
      {
        $set: { status: ProposalStatus.Withdrawn, ...touch(at) },
        $unset: { openChangeRequestId: '' },
      },
    );
    if (!updated) throw conflict(ERRORS.proposals.closed);
    await changeRequests(req).updateMany(
      { proposalId: p._id, status: ChangeRequestStatus.Open },
      { $set: { status: ChangeRequestStatus.Withdrawn } },
    );
    await addMessage(
      req.repo,
      p._id,
      Party.System,
      NAMES.system,
      THREAD.withdrawn(req.principal!.name),
      at,
    );
    res.json(await loadDetail(req, updated));
  });

  router.post('/:id/change-requests/preview', async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    if (p.locked && !isStaff(req.principal)) throw forbidden(ERRORS.proposals.offeredAsIs);
    const input = parse(changePreviewSchema, req.body);
    const pc = await pricingContext(ctx, req);
    const base = await currentRevision(req, p);
    const { quote, items } = previewChanges(
      await loadHouse(req, p.houseId),
      pc,
      base,
      input.changes,
      await carriedExtras(req, base),
      (isStaff(req.principal) && input.adjustments) || base.quote.adjustments,
    );
    res.json({
      quote,
      changes: items.map(({ label, deltaCents }) => ({ label, deltaCents })),
    } satisfies ChangePreview);
  });

  router.post('/:id/change-requests', buyerOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    if (p.locked) throw forbidden(ERRORS.proposals.offeredAsIsNoChanges);
    if (p.status === ProposalStatus.ChangesRequested)
      throw conflict(ERRORS.proposals.requestAlreadyOpen);
    if (p.status !== ProposalStatus.Proposed) throw conflict(ERRORS.proposals.closed);
    const input = parse(changeRequestCreateSchema, req.body);
    if (input.baseRevision !== p.currentRevision) throw conflict(ERRORS.proposals.newerRevision);
    const pc = await pricingContext(ctx, req);
    const base = await currentRevision(req, p);
    const { quote, items } = previewChanges(
      await loadHouse(req, p.houseId),
      pc,
      base,
      input.changes,
      await carriedExtras(req, base),
    );

    const at = now();
    const crId = newId();
    const claimed = await proposals(req).findOneAndUpdate(
      {
        _id: p._id,
        status: ProposalStatus.Proposed,
        currentRevision: input.baseRevision,
        locked: false,
      },
      {
        $set: { status: ProposalStatus.ChangesRequested, openChangeRequestId: crId, ...touch(at) },
      },
    );
    if (!claimed) throw conflict(ERRORS.proposals.changedReload);
    const name = authorName(req, p);
    await changeRequests(req).insertOne({
      _id: crId,
      proposalId: p._id,
      baseRevision: input.baseRevision,
      changes: items.map((i) => ({ id: newId(), ...i })),
      previewTotalCents: quote.totalCents,
      status: ChangeRequestStatus.Open,
      authorName: name,
      createdAt: at.toISOString(),
      ...(input.note && { note: input.note }),
    });
    await addMessage(
      req.repo,
      p._id,
      Party.System,
      NAMES.system,
      THREAD.changesRequested(name, items.length, input.baseRevision, money(quote)),
      at,
    );
    if (input.note) await addMessage(req.repo, p._id, Party.Buyer, name, input.note, at);
    res.status(201).json(await loadDetail(req, claimed));
  });

  router.post('/:id/change-requests/:crId/withdraw', buyerOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const crId = req.params['crId'] as string;
    const at = now();
    const updated = await proposals(req).findOneAndUpdate(
      { _id: p._id, status: ProposalStatus.ChangesRequested, openChangeRequestId: crId },
      {
        $set: { status: ProposalStatus.Proposed, ...touch(at) },
        $unset: { openChangeRequestId: '' },
      },
    );
    if (!updated) throw conflict(ERRORS.proposals.noOpenRequest);
    await changeRequests(req).updateOne(
      { _id: crId, status: ChangeRequestStatus.Open },
      { $set: { status: ChangeRequestStatus.Withdrawn } },
    );
    await addMessage(
      req.repo,
      p._id,
      Party.System,
      NAMES.system,
      THREAD.requestWithdrawn(authorName(req, p)),
      at,
    );
    res.json(await loadDetail(req, updated));
  });

  router.post('/:id/change-requests/:crId/decision', staffOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const crId = req.params['crId'] as string;
    const cr = await changeRequests(req).findOne({ _id: crId, proposalId: p._id });
    if (!cr) throw notFound(ERRORS.proposals.requestNotFound);
    if (cr.status !== ChangeRequestStatus.Open || p.openChangeRequestId !== crId)
      throw conflict(ERRORS.proposals.requestAnswered);
    const input = parse(decisionSchema, req.body);
    const byId = new Map(input.decisions.map((d) => [d.changeId, d]));
    if (byId.size !== cr.changes.length || cr.changes.some((c) => !byId.has(c.id))) {
      throw unprocessable(ERRORS.proposals.decideEveryChange);
    }

    const base = await currentRevision(req, p);
    const approved = cr.changes.filter((c) => byId.get(c.id)!.approved).map((c) => c.change);
    const adjustments = input.adjustments ?? base.quote.adjustments;
    const pc = await pricingContext(ctx, req);
    const selections = applyOrThrow(base.selections, approved, pc.catalog);
    const quote = price(
      await loadHouse(req, p.houseId),
      pc,
      selections,
      adjustments,
      await carriedExtras(req, base),
    );
    const changed =
      approved.length > 0 || JSON.stringify(adjustments) !== JSON.stringify(base.quote.adjustments);
    const standing = changed ? quote : base.quote;

    const at = now();
    const number = changed ? p.currentRevision + 1 : p.currentRevision;
    const claimed = await proposals(req).findOneAndUpdate(
      {
        _id: p._id,
        status: ProposalStatus.ChangesRequested,
        openChangeRequestId: crId,
        currentRevision: p.currentRevision,
      },
      {
        $set: {
          status: ProposalStatus.Proposed,
          currentRevision: number,
          currentTotalCents: standing.totalCents,
          ...touch(at),
        },
        $unset: { openChangeRequestId: '' },
      },
    );
    if (!claimed) throw conflict(ERRORS.proposals.requestAnswered);
    if (changed) {
      await revisions(req).insertOne({
        _id: newId(),
        proposalId: p._id,
        number,
        selections,
        quote,
        authorName: req.principal!.name,
        changeRequestId: crId,
        createdAt: at.toISOString(),
        ...(input.note && { note: input.note }),
      });
    }
    await changeRequests(req).updateOne(
      { _id: crId },
      {
        $set: {
          status: ChangeRequestStatus.Resolved,
          resolvedAt: at.toISOString(),
          resolvedByName: req.principal!.name,
          resultRevision: number,
          changes: cr.changes.map((c) => {
            const d = byId.get(c.id)!;
            return {
              ...c,
              decision: d.approved ? ChangeDecision.Approved : ChangeDecision.Declined,
              ...(d.note && { decisionNote: d.note }),
            };
          }),
        },
      },
    );
    await addMessage(
      req.repo,
      p._id,
      Party.System,
      NAMES.system,
      THREAD.decided(
        req.principal!.name,
        approved.length,
        cr.changes.length,
        number,
        money(standing),
        changed,
      ),
      at,
    );
    if (input.note)
      await addMessage(req.repo, p._id, Party.Seller, req.principal!.name, input.note, at);
    res.json(await loadDetail(req, claimed));
  });

  router.post('/:id/sign', buyerOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const input = parse(signSchema, req.body);
    if (p.status === ProposalStatus.ChangesRequested)
      throw conflict(ERRORS.proposals.withdrawOrWait);
    if (p.status !== ProposalStatus.Proposed) throw conflict(ERRORS.proposals.closed);
    if (input.revision !== p.currentRevision)
      throw conflict(ERRORS.proposals.newerRevisionBeforeSigning);
    const at = now();
    const signature = {
      fullName: input.fullName,
      revision: input.revision,
      totalCents: p.currentTotalCents,
      signedAt: at.toISOString(),
    };
    const signed = await proposals(req).findOneAndUpdate(
      { _id: p._id, status: ProposalStatus.Proposed, currentRevision: input.revision },
      { $set: { status: ProposalStatus.Signed, signature, ...touch(at) } },
    );
    if (!signed) throw conflict(ERRORS.proposals.changedBeforeSigning);
    if (p.inventoryHomeId) {
      await req.repo
        .of<InventoryHomeDoc>('inventoryHomes')
        .updateOne(
          { _id: p.inventoryHomeId, status: { $ne: InventoryStatus.Sold } },
          { $set: { status: InventoryStatus.Reserved, updatedAt: at.toISOString() } },
        );
    }
    await addMessage(
      req.repo,
      p._id,
      Party.System,
      NAMES.system,
      THREAD.signed(input.fullName, input.revision, formatMoney(p.currentTotalCents, p.currency)),
      at,
    );
    res.json(await loadDetail(req, signed));
  });

  router.post('/:id/decline', buyerOnly, async (req, res) => {
    const p = await loadProposalFor(req, id(req));
    const at = now();
    const updated = await proposals(req).findOneAndUpdate(
      { _id: p._id, status: { $in: [...ACTIVE_PROPOSAL_STATUSES] } },
      {
        $set: { status: ProposalStatus.Declined, ...touch(at) },
        $unset: { openChangeRequestId: '' },
      },
    );
    if (!updated) throw conflict(ERRORS.proposals.closed);
    await changeRequests(req).updateMany(
      { proposalId: p._id, status: ChangeRequestStatus.Open },
      { $set: { status: ChangeRequestStatus.Withdrawn } },
    );
    await addMessage(
      req.repo,
      p._id,
      Party.System,
      NAMES.system,
      THREAD.declined(authorName(req, p)),
      at,
    );
    res.json(await loadDetail(req, updated));
  });

  return router;
};
