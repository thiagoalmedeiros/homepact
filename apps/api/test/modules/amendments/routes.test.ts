import {
  AccessKeyStatus,
  AccessResourceType,
  AgreementStatus,
  AmendmentStatus,
  ApprovalReason,
  ChangeDecision,
  GuestRole,
  PaymentKind,
  PaymentStatus,
  ProposalStatus,
  SignerStatus,
  type Change,
  type QuoteSnapshot,
} from '@homepact/shared';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '../../../src/auth/tokens.js';
import { createMemoryDatabase } from '../../../src/data/memory-db.js';
import { tenantRepo, type TenantRepo } from '../../../src/data/tenant-repo.js';
import { agreementRoutes } from '../../../src/modules/agreements/routes.js';
import type { AgreementDoc, AgreementFileDoc } from '../../../src/modules/agreements/store.js';
import {
  amendmentLookupRoutes,
  amendmentPolicyRoutes,
  amendmentQueueRoutes,
  amendmentRoutes,
} from '../../../src/modules/amendments/routes.js';
import type { AmendmentDoc } from '../../../src/modules/amendments/store.js';
import { agreementPaymentRoutes } from '../../../src/modules/payments/routes.js';
import type { MessageDoc } from '../../../src/modules/proposals/store.js';
import {
  accessKeyDoc,
  agreementDoc,
  areaDoc,
  HASH,
  houseDoc,
  itemDoc,
  packageDoc,
  paymentDoc,
  proposalDoc,
  quote,
  revisionDoc,
  SIGNATURE,
  signature,
  signedPurchaser,
} from '../../support/fixtures.js';
import {
  ADMIN,
  agreementSigner,
  BUYER,
  COMPANY_TENANT,
  FINANCE,
  keyHolder,
  mockContext,
  serveRouter,
  STAFF,
  type Harness,
  type MockContext,
  type Scene,
} from '../../support/mocks.js';

/** Ontario, 13% HST on a $500,000 home with the Standard kitchen. */
const SIGNED_QUOTE: QuoteSnapshot = quote({
  lines: [
    {
      areaSlug: 'kitchen',
      areaLabel: 'Kitchen',
      kind: 'package',
      refId: 'pkg-standard',
      name: 'Standard',
      unitCents: 0,
    },
  ],
  subtotalCents: 50_000_000,
  tax: {
    regionCode: 'ON',
    regionName: 'Ontario',
    lines: [{ label: 'HST', ratePercent: 13, amountCents: 6_500_000 }],
    totalCents: 6_500_000,
  },
  totalCents: 56_500_000,
});
const EXECUTED: AgreementDoc = agreementDoc({
  status: AgreementStatus.Executed,
  quote: SIGNED_QUOTE,
  purchasers: [
    signedPurchaser({ id: 'pur-1' }),
    signedPurchaser({ id: 'pur-2', name: 'Ben Buyer', email: 'ben@buyer.test' }),
  ],
  issuedAt: '2026-10-01T10:00:00.000Z',
  signedAt: '2026-10-02T10:00:00.000Z',
  counterSignature: signature({ fullName: 'Alex Admin', initials: [] }),
  executedAt: '2026-10-03T10:00:00.000Z',
  executedPdf: { fileId: 'file-agr', sha256: 'f'.repeat(64), size: 12 },
});
const ADD_OAK: Change = { type: 'add_item', areaSlug: 'flooring', itemId: 'item-oak' };
const SIGNATURE_KITCHEN: Change = {
  type: 'set_package',
  areaSlug: 'kitchen',
  packageId: 'pkg-signature',
};
const OTHER_BUYER: Principal = { ...BUYER, sub: 'buyer-2', name: 'Olive Other' };
const ADMIN_2: Principal = { ...ADMIN, sub: 'admin-2', name: 'Ari Admin' };
const BASE = '/agreements/agr-1/amendments';

let h: Harness;
let ctx: MockContext;
let repo: TenantRepo;
let scene: Scene;

const put = <T extends { _id: string; companyId: string | null }>(
  name: Parameters<TenantRepo['of']>[0],
  doc: T,
) => {
  const { companyId: _c, ...rest } = doc;
  return repo.of<T>(name).insertOne(rest);
};

const as = (principal: Principal) => {
  scene.principal = principal;
};
const call = (principal: Principal, method: string, path: string, body?: unknown) => {
  as(principal);
  return h.call(method, path, body);
};

const amendment = async (id: string) =>
  (await repo.of<AmendmentDoc>('agreementAmendments').findOne({ _id: id }))!;
const thread = async () =>
  (await repo.of<MessageDoc>('proposalMessages').find({}, { sort: { createdAt: 1 } })).map(
    (m) => m.body,
  );

/** A purchaser on their own amendment signing link (key and code). */
const amendmentSigner = async (amendmentId: string, purchaserId: string): Promise<Principal> => {
  const id = `key-${amendmentId}-${purchaserId}`;
  if (!(await repo.of('accessKeys').findOne({ _id: id }))) {
    await put(
      'accessKeys',
      accessKeyDoc({
        _id: id,
        hash: id,
        resourceType: AccessResourceType.Amendment,
        resourceId: amendmentId,
        signerId: purchaserId,
      }),
    );
  }
  return {
    sub: id,
    role: GuestRole.KeyHolder,
    companyId: COMPANY_TENANT.companyId,
    name: 'Guest',
    resource: { type: AccessResourceType.Amendment, id: amendmentId },
    signerId: purchaserId,
  };
};

const request = async (changes: Change[] = [ADD_OAK], by: Principal = BUYER) => {
  const res = await call(by, 'POST', BASE, { changes, note: 'Oak please' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const approveAll = async (id: string) =>
  (await amendment(id)).changes.map((c) => ({ changeId: c.id, approved: true }));
const price = async (id: string, extra: object = {}, by: Principal = STAFF) => {
  const res = await call(by, 'PUT', `${BASE}/${id}`, { decisions: await approveAll(id), ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.contentHash as string;
};
const issue = async (id: string, by: Principal = STAFF) => {
  const contentHash = (await amendment(id)).contentHash;
  const res = await call(by, 'POST', `${BASE}/${id}/issue`, {
    contentHash,
    fullName: by.name,
    agree: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const sign = async (id: string, purchaserId: string) =>
  call(await amendmentSigner(id, purchaserId), 'POST', `${BASE}/${id}/sign`, {
    contentHash: (await amendment(id)).contentHash,
    fullName: purchaserId === 'pur-1' ? 'Bea Buyer' : 'Ben Buyer',
    agree: true,
  });
const signAll = async (id: string) => {
  expect((await sign(id, 'pur-1')).status).toBe(200);
  const last = await sign(id, 'pur-2');
  expect(last.status, JSON.stringify(last.body)).toBe(200);
  return last.body;
};
const approve = (id: string, by: Principal = ADMIN) =>
  amendment(id).then((a) =>
    call(by, 'POST', `${BASE}/${id}/approve`, {
      contentHash: a.contentHash,
      fullName: by.name,
      agree: true,
    }),
  );
/** A $250 fee set by hand: the default policy wants an administrator to approve it. */
const FEE = { adjustments: [{ label: 'Change order fee', amountCents: 25_000 }] };

/** Requested, priced, sent and signed by both purchasers: executed when no approval is needed
 * (no fee), waiting for an administrator otherwise. */
const throughSignatures = async (priceWith: object = {}, changes: Change[] = [ADD_OAK]) => {
  const id = await request(changes);
  await price(id, priceWith);
  await issue(id);
  await signAll(id);
  return id;
};
const executeOne = () => throughSignatures();
const awaitingApproval = () => throughSignatures(FEE);

beforeEach(async () => {
  const { db } = createMemoryDatabase();
  repo = tenantRepo(db, COMPANY_TENANT.companyId);
  scene = { tenant: COMPANY_TENANT, repo, principal: STAFF };
  ctx = mockContext({ db });
  await put('agreements', EXECUTED);
  await put('agreementFiles', {
    _id: 'file-agr',
    companyId: COMPANY_TENANT.companyId,
    agreementId: 'agr-1',
    kind: 'executed',
    contentType: 'application/pdf',
    data: Buffer.from('original pdf'),
    sha256: 'f'.repeat(64),
    size: 12,
    createdAt: EXECUTED.executedAt!,
  } satisfies AgreementFileDoc);
  await put(
    'proposals',
    proposalDoc({ status: ProposalStatus.Signed, signature: SIGNATURE, agreementId: 'agr-1' }),
  );
  await put('revisions', revisionDoc({ quote: SIGNED_QUOTE }));
  await put('accessKeys', accessKeyDoc());
  await put('houses', houseDoc());
  await put('areas', areaDoc());
  await put('areas', areaDoc({ _id: 'area-2', slug: 'flooring', label: 'Flooring', order: 2 }));
  await put('catalogItems', itemDoc());
  await put('catalogItems', itemDoc({ _id: 'item-hood', name: 'Range hood', priceCents: 150_000 }));
  await put(
    'catalogItems',
    itemDoc({ _id: 'item-oak', areaSlug: 'flooring', name: 'Oak', priceCents: 800_000 }),
  );
  await put('packages', packageDoc());
  await put(
    'packages',
    packageDoc({ _id: 'pkg-standard', name: 'Standard', itemIds: ['item-hood'], priceCents: 0 }),
  );

  const app = express.Router();
  app.use('/agreements/:agreementId/amendments', amendmentRoutes(ctx));
  app.use('/agreements/:agreementId/payments', agreementPaymentRoutes(ctx));
  app.use('/agreements', agreementRoutes(ctx));
  app.use('/agreement-amendments', amendmentQueueRoutes(ctx));
  app.use('/amendment-policy', amendmentPolicyRoutes(ctx));
  app.use('/amendments', amendmentLookupRoutes(ctx));
  h = await serveRouter(app, scene);
});

afterEach(() => h.close());

describe('GET /current and /options (where the agreement stands)', () => {
  it('is the agreement as signed, with its selections, for the company and the buyer', async () => {
    for (const who of [STAFF, ADMIN, FINANCE, BUYER, keyHolder('proposal-1')]) {
      const res = await call(who, 'GET', `${BASE}/current`);
      expect(res.status, who.role).toBe(200);
      expect(res.body).toEqual({
        state: {
          quote: SIGNED_QUOTE,
          terms: EXECUTED.terms,
          currency: 'CAD',
          totalCents: 56_500_000,
          amendments: [],
        },
        selections: { kitchen: { packageId: 'pkg-standard' } },
      });
    }
  });

  it('offers the plan’s catalog with the home as it stands', async () => {
    const res = await call(BUYER, 'GET', `${BASE}/options`);
    expect(res.status).toBe(200);
    expect(res.body.selections).toEqual({ kitchen: { packageId: 'pkg-standard' } });
    expect(res.body.options.areas.map((a: { slug: string }) => a.slug)).toEqual([
      'kitchen',
      'flooring',
    ]);
  });

  it('tells the buyer when the home is offered as-is, and which change order is open', async () => {
    await repo.of('proposals').updateOne({ _id: 'proposal-1' }, { $set: { locked: true } });
    expect((await call(BUYER, 'GET', `${BASE}/current`)).body.offeredAsIs).toBe(true);
    const id = await request([ADD_OAK], STAFF);
    expect((await call(BUYER, 'GET', `${BASE}/current`)).body.openAmendmentId).toBe(id);
  });

  it('stays closed to other buyers, signing links and unknown agreements', async () => {
    expect((await call(OTHER_BUYER, 'GET', `${BASE}/current`)).status).toBe(404);
    expect(await call(agreementSigner('agr-1', 'pur-1'), 'GET', `${BASE}/current`)).toMatchObject({
      status: 403,
      body: { error: 'A signing link only opens what it was sent to sign' },
    });
    expect((await call(STAFF, 'GET', '/agreements/nope/amendments/current')).status).toBe(404);
  });
});

describe('POST /preview (an estimate before asking)', () => {
  it('prices each change alone and the home with all of them, tax included', async () => {
    const res = await call(BUYER, 'POST', `${BASE}/preview`, {
      changes: [ADD_OAK, SIGNATURE_KITCHEN],
    });
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([
      { label: 'Add Oak (Flooring)', deltaCents: 800_000 },
      { label: 'Change Kitchen: Standard → Signature', deltaCents: 900_000 },
    ]);
    expect(res.body.quote.subtotalCents).toBe(51_700_000);
    expect(res.body.quote.totalCents).toBe(58_421_000);
  });

  it('is for the buyer and sales, not finance', async () => {
    expect((await call(FINANCE, 'POST', `${BASE}/preview`, { changes: [] })).status).toBe(403);
    expect((await call(STAFF, 'POST', `${BASE}/preview`, { changes: [] })).status).toBe(200);
  });
});

describe('POST / (the buyer asks for changes)', () => {
  it('records the request against the agreement as it stands', async () => {
    const id = await request();
    const a = await amendment(id);
    expect(a).toMatchObject({
      status: AmendmentStatus.Requested,
      number: 1,
      agreementId: 'agr-1',
      agreementReference: 'A-TEST-0001',
      proposalId: 'proposal-1',
      basis: { number: 0, contentHash: HASH },
      requestedBy: { party: 'buyer', name: 'Bea Buyer' },
      note: 'Oak please',
      changes: [{ change: ADD_OAK, label: 'Add Oak (Flooring)', deltaCents: 800_000 }],
      adjustments: [],
      deposits: [],
      before: {
        selections: { kitchen: { packageId: 'pkg-standard' } },
        quote: SIGNED_QUOTE,
        terms: EXECUTED.terms,
      },
      seller: EXECUTED.seller,
      home: EXECUTED.home,
      currency: 'CAD',
      history: [{ action: 'requested', by: { id: 'buyer-1', name: 'Bea Buyer', role: 'buyer' } }],
    });
    expect(a.reference).toMatch(/^CO-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(a.purchasers).toEqual([
      { id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test', status: SignerStatus.Pending },
      { id: 'pur-2', name: 'Ben Buyer', email: 'ben@buyer.test', status: SignerStatus.Pending },
    ]);
    expect(a).not.toHaveProperty('after');
    expect(a).not.toHaveProperty('contentHash');
    expect(await thread()).toEqual([
      `Bea Buyer asked to change purchase agreement A-TEST-0001: 1 change (${a.reference}).`,
      'Oak please',
    ]);
  });

  it('can be the buyer’s own words, with no catalog changes yet', async () => {
    const res = await call(BUYER, 'POST', BASE, { note: 'A wider patio door, if possible' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: AmendmentStatus.Requested,
      changes: [],
      note: 'A wider patio door, if possible',
    });
    expect(await thread()).toEqual([
      `Bea Buyer asked to change purchase agreement A-TEST-0001 (${res.body.reference}).`,
      'A wider patio door, if possible',
    ]);
    expect((await call(BUYER, 'POST', BASE, { changes: [] })).status).toBe(400);
  });

  it('can come from the proposal link, or from sales on the buyer’s behalf', async () => {
    const fromLink = await request([ADD_OAK], keyHolder('proposal-1'));
    expect((await amendment(fromLink)).requestedBy).toEqual({ party: 'buyer', name: 'Bea Buyer' });
    await call(STAFF, 'POST', `${BASE}/${fromLink}/decline`, {});
    const fromSales = await request([ADD_OAK], STAFF);
    expect((await amendment(fromSales)).requestedBy).toEqual({
      party: 'seller',
      name: 'Sam Staff',
    });
  });

  it('takes one change order at a time', async () => {
    await request();
    expect(await call(BUYER, 'POST', BASE, { changes: [SIGNATURE_KITCHEN] })).toMatchObject({
      status: 409,
      body: { error: 'Another change order is open on this agreement; finish or close it first' },
    });
  });

  it('refuses changes that do not apply, and agreements that are not executed', async () => {
    expect(
      await call(BUYER, 'POST', BASE, {
        changes: [{ type: 'remove_item', areaSlug: 'flooring', itemId: 'item-oak' }],
      }),
    ).toMatchObject({ status: 422, body: { error: 'Item is not part of this home' } });
    expect(await call(BUYER, 'POST', BASE, { changes: [] })).toMatchObject({ status: 400 });
    await repo
      .of<AgreementDoc>('agreements')
      .updateOne({ _id: 'agr-1' }, { $set: { status: AgreementStatus.Signed } });
    expect(await call(BUYER, 'POST', BASE, { changes: [ADD_OAK] })).toMatchObject({
      status: 409,
      body: { error: 'Only an executed agreement can be amended' },
    });
    expect(await repo.of('agreementAmendments').countDocuments()).toBe(0);
  });

  it('is for the buyer and sales: not finance, other buyers or signing links', async () => {
    expect((await call(FINANCE, 'POST', BASE, { changes: [ADD_OAK] })).status).toBe(403);
    expect((await call(OTHER_BUYER, 'POST', BASE, { changes: [ADD_OAK] })).status).toBe(404);
    expect(
      (await call(agreementSigner('agr-1', 'pur-1'), 'POST', BASE, { changes: [ADD_OAK] })).status,
    ).toBe(403);
    expect(await repo.of('agreementAmendments').countDocuments()).toBe(0);
  });

  it('lets only sales change a home offered as-is', async () => {
    await repo.of('proposals').updateOne({ _id: 'proposal-1' }, { $set: { locked: true } });
    expect(await call(BUYER, 'POST', BASE, { changes: [ADD_OAK] })).toMatchObject({
      status: 403,
      body: { error: 'This home is offered as-is; ask your sales representative for changes' },
    });
    await request([ADD_OAK], STAFF);
  });
});

describe('PUT /:id (sales prices it)', () => {
  it('decides each change and adds fees, credits and instalments', async () => {
    const id = await request([ADD_OAK, SIGNATURE_KITCHEN]);
    const [oak, kitchen] = (await amendment(id)).changes;
    const res = await call(STAFF, 'PUT', `${BASE}/${id}`, {
      decisions: [
        { changeId: oak!.id, approved: true },
        { changeId: kitchen!.id, approved: false, note: 'Cabinets already ordered' },
      ],
      adjustments: [{ label: 'Change order fee', amountCents: 25_000 }],
      deposits: [{ label: 'Change order payment', amountCents: 400_000 }],
      note: 'Oak throughout the main floor',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: AmendmentStatus.Priced,
      pricingNote: 'Oak throughout the main floor',
      changes: [
        { id: oak!.id, decision: ChangeDecision.Approved },
        {
          id: kitchen!.id,
          decision: ChangeDecision.Declined,
          decisionNote: 'Cabinets already ordered',
        },
      ],
      adjustments: [{ label: 'Change order fee', amountCents: 25_000 }],
      approval: { required: true, reasons: [ApprovalReason.Adjustment] },
      pricedBy: { id: 'staff-1', name: 'Sam Staff', role: 'company_staff' },
    });
    expect(res.body.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.after.selections).toEqual({
      kitchen: { packageId: 'pkg-standard' },
      flooring: { itemIds: ['item-oak'] },
    });
    expect(res.body.after.quote.subtotalCents).toBe(50_825_000);
    expect(res.body.after.quote.totalCents).toBe(57_432_250);
    expect(res.body.after.terms.depositCents).toBe(2_900_000);
  });

  it('turns the buyer’s words into catalog changes, priced with tax', async () => {
    const id = (await call(BUYER, 'POST', BASE, { note: 'Hardwood on the main floor' })).body.id;
    expect(await call(STAFF, 'PUT', `${BASE}/${id}`, {})).toMatchObject({
      status: 422,
      body: { error: 'Nothing would change; decline the change order instead' },
    });
    const res = await call(STAFF, 'PUT', `${BASE}/${id}`, { added: [ADD_OAK] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.changes).toEqual([
      {
        id: expect.any(String),
        change: ADD_OAK,
        label: 'Add Oak (Flooring)',
        deltaCents: 800_000,
        decision: ChangeDecision.Approved,
        addedBySeller: true,
      },
    ]);
    expect(res.body.after.quote.tax.totalCents).toBe(6_604_000);
    expect(res.body.after.quote.totalCents).toBe(57_404_000);
  });

  it('keeps the buyer’s changes apart from those sales adds, and replaces the latter', async () => {
    const id = await request([SIGNATURE_KITCHEN]);
    const [kitchen] = (await amendment(id)).changes;
    const decline = { decisions: [{ changeId: kitchen!.id, approved: false }] };
    const first = await call(STAFF, 'PUT', `${BASE}/${id}`, { ...decline, added: [ADD_OAK] });
    expect(first.body.changes.map((c: { label: string }) => c.label)).toEqual([
      'Change Kitchen: Standard → Signature',
      'Add Oak (Flooring)',
    ]);
    const again = await call(STAFF, 'PUT', `${BASE}/${id}`, {
      decisions: [{ changeId: kitchen!.id, approved: true }],
    });
    expect(again.body.changes).toHaveLength(1);
    expect(again.body.changes[0]).not.toHaveProperty('addedBySeller');
    expect(
      await call(STAFF, 'PUT', `${BASE}/${id}`, {
        decisions: [{ changeId: kitchen!.id, approved: true }],
        added: [ADD_OAK, ADD_OAK],
      }),
    ).toMatchObject({ status: 422, body: { error: 'Item already included' } });
  });

  it('is for sales and administrators', async () => {
    const id = await request();
    const body = { decisions: await approveAll(id) };
    for (const who of [BUYER, FINANCE, keyHolder('proposal-1')]) {
      expect((await call(who, 'PUT', `${BASE}/${id}`, body)).status, who.role).toBe(403);
    }
    expect((await call(ADMIN, 'PUT', `${BASE}/${id}`, body)).status).toBe(200);
  });

  it('refuses undecided changes, nothing to amend, a deposit above the price', async () => {
    const id = await request([ADD_OAK, SIGNATURE_KITCHEN]);
    const [oak, kitchen] = (await amendment(id)).changes;
    const decide = (body: object) => call(STAFF, 'PUT', `${BASE}/${id}`, body);
    expect(await decide({ decisions: [{ changeId: oak!.id, approved: true }] })).toMatchObject({
      status: 422,
      body: { error: 'Approve or decline every requested change' },
    });
    const none = [
      { changeId: oak!.id, approved: false },
      { changeId: kitchen!.id, approved: false },
    ];
    expect(await decide({ decisions: none })).toMatchObject({
      status: 422,
      body: { error: 'Nothing would change; decline the change order instead' },
    });
    const all = await approveAll(id);
    expect(
      await decide({ decisions: all, deposits: [{ label: 'x', amountCents: 60_000_000 }] }),
    ).toMatchObject({
      status: 422,
      body: { error: 'The deposit cannot be more than the purchase price' },
    });
    expect(
      await decide({
        decisions: all,
        adjustments: [{ label: 'Credit', amountCents: -90_000_000 }],
      }),
    ).toMatchObject({ status: 422, body: { error: 'Total cannot be negative' } });
    expect((await amendment(id)).status).toBe(AmendmentStatus.Requested);
  });

  it('re-pricing a sent amendment voids its signatures, links and the company signature', async () => {
    const id = await request();
    await price(id);
    await issue(id);
    expect((await sign(id, 'pur-1')).status).toBe(200);
    ctx.signatures.revoke.mockClear();

    await price(id, FEE);
    const a = await amendment(id);
    expect(a.status).toBe(AmendmentStatus.Priced);
    expect(a.purchasers[0]).toMatchObject({ status: SignerStatus.Invalidated });
    expect(a.purchasers[0]!.signature).toBeDefined();
    expect(a).not.toHaveProperty('sellerSignature');
    expect(a).not.toHaveProperty('issuedAt');
    expect(ctx.signatures.revoke).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resource: { type: AccessResourceType.Amendment, id } }),
    );
    expect(await sign(id, 'pur-2')).toMatchObject({ status: 409 });
    expect((await thread()).at(-1)).toBe(
      `Sam Staff changed the price of ${a.reference}; 1 signature is no longer valid and it must be sent again.`,
    );
  });

  it('cannot re-price once every purchaser has signed', async () => {
    const id = await awaitingApproval();
    expect(
      await call(STAFF, 'PUT', `${BASE}/${id}`, { decisions: await approveAll(id) }),
    ).toMatchObject({
      status: 409,
      body: { error: 'Every purchaser has signed this change order; it can no longer be changed' },
    });
  });
});

describe('POST /:id/price-preview (the draft as sales shapes it)', () => {
  it('prices the draft, tax and approval included, without saving it', async () => {
    const id = await request();
    const res = await call(STAFF, 'POST', `${BASE}/${id}/price-preview`, {
      decisions: await approveAll(id),
      ...FEE,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      changes: [{ label: 'Add Oak (Flooring)', deltaCents: 800_000, decision: 'approved' }],
      after: { quote: { subtotalCents: 50_825_000, totalCents: 57_432_250 } },
      approval: { required: true, reasons: [ApprovalReason.Adjustment] },
    });
    expect(await amendment(id)).toMatchObject({ status: AmendmentStatus.Requested });
    expect((await amendment(id)).after).toBeUndefined();
  });

  it('is for sales, on a change order still open to changes', async () => {
    const id = await request();
    const body = { decisions: await approveAll(id) };
    expect((await call(BUYER, 'POST', `${BASE}/${id}/price-preview`, body)).status).toBe(403);
    expect((await call(FINANCE, 'POST', `${BASE}/${id}/price-preview`, body)).status).toBe(403);
    await call(STAFF, 'POST', `${BASE}/${id}/decline`, {});
    expect((await call(STAFF, 'POST', `${BASE}/${id}/price-preview`, body)).status).toBe(409);
  });
});

describe('POST /:id/issue (sales signs and sends it)', () => {
  it('signs for the company and invites each purchaser on their own amendment link', async () => {
    const id = await request();
    const contentHash = await price(id);
    const body = await issue(id);
    const a = await amendment(id);
    expect(body.amendment).toMatchObject({
      status: AmendmentStatus.UnderReview,
      issuedBy: { id: 'staff-1', name: 'Sam Staff' },
      sellerSignature: { fullName: 'Sam Staff', contentHash },
    });
    expect(body.invitations.map((i: { purchaserId: string }) => i.purchaserId)).toEqual([
      'pur-1',
      'pur-2',
    ]);
    const envelope = {
      agreementId: 'agr-1',
      reference: a.reference,
      title: 'Amendment 1 to purchase agreement A-TEST-0001',
      contentHash,
      resource: { type: AccessResourceType.Amendment, id },
    };
    expect(ctx.signatures.capture).toHaveBeenCalledWith(
      expect.anything(),
      envelope,
      { id: 'staff-1', name: 'Sam Staff' },
      expect.objectContaining({ fullName: 'Sam Staff', contentHash }),
    );
    expect(ctx.signatures.invite).toHaveBeenCalledWith(expect.anything(), envelope, [
      { id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' },
      { id: 'pur-2', name: 'Ben Buyer', email: 'ben@buyer.test' },
    ]);
    expect((await thread()).at(-1)).toBe(
      `Sam Staff sent change order ${a.reference} for signature: $565,000 becomes $574,040.`,
    );
  });

  it('needs the priced content, and sales', async () => {
    const id = await request();
    const sendAs = (who: Principal, contentHash: unknown) =>
      call(who, 'POST', `${BASE}/${id}/issue`, { contentHash, fullName: who.name, agree: true });
    expect(await sendAs(STAFF, 'a'.repeat(64))).toMatchObject({
      status: 409,
      body: { error: 'Price the change order before sending it' },
    });
    const contentHash = await price(id);
    expect(await sendAs(STAFF, 'a'.repeat(64))).toMatchObject({
      status: 409,
      body: { error: 'The change order changed; review it again' },
    });
    expect((await sendAs(BUYER, contentHash)).status).toBe(403);
    expect((await sendAs(FINANCE, contentHash)).status).toBe(403);
    expect((await sendAs(STAFF, contentHash)).status).toBe(200);
    expect(await sendAs(STAFF, contentHash)).toMatchObject({ status: 409 });
  });
});

describe('POST /:id/sign (each purchaser signs)', () => {
  it('takes a purchaser’s signature on their own link only', async () => {
    const id = await request();
    await price(id);
    await issue(id);
    const body = { contentHash: (await amendment(id)).contentHash, fullName: 'Bea', agree: true };
    expect(
      (await call(agreementSigner('agr-1', 'pur-1'), 'POST', `${BASE}/${id}/sign`, body)).status,
    ).toBe(403);
    expect((await call(BUYER, 'POST', `${BASE}/${id}/sign`, body)).status).toBe(403);
    expect((await call(STAFF, 'POST', `${BASE}/${id}/sign`, body)).status).toBe(403);
    const signer = await amendmentSigner(id, 'pur-1');
    expect(
      await call(signer, 'POST', `${BASE}/${id}/sign`, { ...body, contentHash: 'b'.repeat(64) }),
    ).toMatchObject({ status: 409, body: { error: 'The change order changed; review it again' } });

    const res = await call(signer, 'POST', `${BASE}/${id}/sign`, body);
    expect(res.status).toBe(200);
    expect(res.body.viewerPurchaserId).toBe('pur-1');
    expect(res.body.status).toBe(AmendmentStatus.UnderReview);
    expect(res.body.purchasers[0]).toMatchObject({
      status: SignerStatus.Signed,
      signature: { fullName: 'Bea' },
    });
    expect(await call(signer, 'POST', `${BASE}/${id}/sign`, body)).toMatchObject({
      status: 409,
      body: { error: 'You already signed this change order' },
    });
    expect((await thread()).at(-1)).toBe(
      `Bea signed change order ${res.body.reference} (1 of 2 purchasers).`,
    );
  });

  it('executes with the last signature when no approval is needed, and everything reads it', async () => {
    const id = await request();
    await price(id);
    await issue(id);
    ctx.signatures.revoke.mockClear();
    const done = await signAll(id);

    expect(done).toMatchObject({
      status: AmendmentStatus.Executed,
      executedAt: expect.any(String),
    });
    expect(done.executedPdf).toEqual({ sha256: expect.any(String), size: expect.any(Number) });
    const file = await repo
      .of<AgreementFileDoc>('agreementFiles')
      .findOne({ agreementId: 'agr-1', kind: 'amendment' });
    expect(file).toMatchObject({ amendmentId: id, sha256: done.executedPdf.sha256 });
    expect(ctx.signatures.revoke).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resource: { type: AccessResourceType.Amendment, id } }),
    );

    const current = (await call(STAFF, 'GET', `${BASE}/current`)).body;
    expect(current.state.totalCents).toBe(57_404_000);
    expect(current.state.amendments).toEqual([
      {
        number: 1,
        reference: done.reference,
        contentHash: done.contentHash,
        executedAt: done.executedAt,
        totalCents: 57_404_000,
      },
    ]);
    expect(current.selections).toEqual({
      kitchen: { packageId: 'pkg-standard' },
      flooring: { itemIds: ['item-oak'] },
    });
    const ledger = (await call(FINANCE, 'GET', '/agreements/agr-1/payments')).body;
    expect(ledger.schedule.totals.totalCents).toBe(57_404_000);
    const list = (await call(STAFF, 'GET', '/agreements')).body;
    expect(list[0].totalCents).toBe(57_404_000);
    expect((await thread()).slice(-2)).toEqual([
      `Ben Buyer signed change order ${done.reference} (2 of 2 purchasers).`,
      `Change order ${done.reference} is executed: purchase agreement A-TEST-0001 now stands at $574,040.`,
    ]);

    await request([SIGNATURE_KITCHEN]);
  });

  it('waits for an administrator when the policy asks for approval', async () => {
    const id = await request();
    await price(id, FEE);
    await issue(id);
    const done = await signAll(id);
    expect(done).toMatchObject({
      status: AmendmentStatus.AwaitingApproval,
      signedAt: expect.any(String),
      approval: { required: true, reasons: [ApprovalReason.Adjustment] },
    });
    expect((await call(STAFF, 'GET', `${BASE}/current`)).body.state.totalCents).toBe(56_500_000);
    expect((await thread()).at(-1)).toBe(
      `Every purchaser signed change order ${done.reference}; it is waiting for the Seller’s approval.`,
    );
  });

  it('needs approval when the new price is below the money received, whatever the policy', async () => {
    await call(ADMIN, 'PUT', '/amendment-policy', {
      approveCredits: false,
      approveAdjustments: false,
    });
    const id = await request();
    await price(id, { adjustments: [{ label: 'Goodwill credit', amountCents: -1_000_000 }] });
    expect((await amendment(id)).approval).toEqual({ required: false, reasons: [] });
    await issue(id);
    await put(
      'agreementPayments',
      paymentDoc({ _id: 'pay-all', amountCents: 56_500_000, kind: PaymentKind.Payment }),
    );
    const done = await signAll(id);
    expect(done).toMatchObject({
      status: AmendmentStatus.AwaitingApproval,
      approval: { required: true, reasons: [ApprovalReason.RefundDue] },
    });
  });
});

describe('POST /:id/approve and /:id/reject (an administrator decides)', () => {
  it('an administrator other than who priced or sent it approves, which executes it', async () => {
    const id = await awaitingApproval();
    const res = await approve(id, ADMIN);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: AmendmentStatus.Executed,
      approvedBy: { id: 'admin-1', name: 'Alex Admin' },
      approvalSignature: { fullName: 'Alex Admin' },
    });
    expect((await call(STAFF, 'GET', `${BASE}/current`)).body.state.totalCents).toBe(57_432_250);
    expect((await thread()).slice(-2)).toEqual([
      `Alex Admin approved change order ${res.body.reference}.`,
      `Change order ${res.body.reference} is executed: purchase agreement A-TEST-0001 now stands at $574,322.50.`,
    ]);
  });

  it('only an administrator, never the one who priced or sent it', async () => {
    const id = await request();
    await price(id, FEE, ADMIN);
    await issue(id, ADMIN_2);
    await signAll(id);
    for (const who of [STAFF, FINANCE, BUYER]) {
      expect((await approve(id, who)).status, who.role).toBe(403);
    }
    expect(await approve(id, ADMIN)).toMatchObject({
      status: 403,
      body: { error: 'Someone else must approve a change order you priced or sent' },
    });
    expect(await approve(id, ADMIN_2)).toMatchObject({ status: 403 });
    expect(
      await call({ ...ADMIN, sub: 'admin-3' }, 'POST', `${BASE}/${id}/approve`, {
        contentHash: 'c'.repeat(64),
        fullName: 'Third Admin',
        agree: true,
      }),
    ).toMatchObject({ status: 409 });
    expect((await approve(id, { ...ADMIN, sub: 'admin-3' })).status).toBe(200);
  });

  it('there is nothing to approve before every purchaser has signed', async () => {
    const id = await request();
    await price(id);
    expect(await approve(id)).toMatchObject({
      status: 409,
      body: { error: 'This change order is not waiting for approval' },
    });
  });

  it('a rejection gives its reason, closes it and changes nothing', async () => {
    const id = await awaitingApproval();
    expect((await call(STAFF, 'POST', `${BASE}/${id}/reject`, { reason: 'Too low' })).status).toBe(
      403,
    );
    expect((await call(ADMIN, 'POST', `${BASE}/${id}/reject`, {})).status).toBe(400);
    const res = await call(ADMIN, 'POST', `${BASE}/${id}/reject`, {
      reason: 'Fee waived in error',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: AmendmentStatus.Rejected,
      closedBy: { id: 'admin-1' },
      closeReason: 'Fee waived in error',
    });
    expect((await call(STAFF, 'GET', `${BASE}/current`)).body.state.amendments).toEqual([]);
    expect((await thread()).at(-1)).toBe(
      `Alex Admin did not approve change order ${res.body.reference}. Fee waived in error`,
    );
    await request([SIGNATURE_KITCHEN]);
  });
});

describe('POST /:id/decline and /:id/withdraw (closing it early)', () => {
  it('sales declines it, the buyer withdraws it, until every purchaser has signed', async () => {
    const declined = await request();
    await price(declined);
    await issue(declined);
    ctx.signatures.revoke.mockClear();
    expect((await call(BUYER, 'POST', `${BASE}/${declined}/decline`, {})).status).toBe(403);
    const res = await call(STAFF, 'POST', `${BASE}/${declined}/decline`, { reason: 'Too late' });
    expect(res.body).toMatchObject({ status: AmendmentStatus.Declined, closeReason: 'Too late' });
    expect(ctx.signatures.revoke).toHaveBeenCalled();
    expect((await thread()).at(-1)).toBe(
      `Sam Staff declined change order ${res.body.reference}. Too late`,
    );

    const withdrawn = await request();
    expect((await call(STAFF, 'POST', `${BASE}/${withdrawn}/withdraw`, {})).status).toBe(403);
    expect((await call(OTHER_BUYER, 'POST', `${BASE}/${withdrawn}/withdraw`, {})).status).toBe(404);
    const back = await call(BUYER, 'POST', `${BASE}/${withdrawn}/withdraw`, {});
    expect(back.body).toMatchObject({ status: AmendmentStatus.Withdrawn });
    expect((await thread()).at(-1)).toBe(`Bea Buyer withdrew change order ${back.body.reference}.`);
    expect(await call(BUYER, 'POST', `${BASE}/${withdrawn}/withdraw`, {})).toMatchObject({
      status: 409,
      body: { error: 'This change order is closed' },
    });

    const signed = await awaitingApproval();
    expect((await call(BUYER, 'POST', `${BASE}/${signed}/withdraw`, {})).status).toBe(409);
    expect((await call(STAFF, 'POST', `${BASE}/${signed}/decline`, {})).status).toBe(409);
  });
});

describe('POST /:id/purchasers/:purchaserId/invite', () => {
  it('gives a purchaser a new link while it is out for signature', async () => {
    const id = await request();
    await price(id);
    expect((await call(STAFF, 'POST', `${BASE}/${id}/purchasers/pur-1/invite`, {})).status).toBe(
      409,
    );
    await issue(id);
    const res = await call(STAFF, 'POST', `${BASE}/${id}/purchasers/pur-2/invite`, {});
    expect(res).toMatchObject({ status: 201, body: { purchaserId: 'pur-2' } });
    expect((await call(STAFF, 'POST', `${BASE}/${id}/purchasers/nope/invite`, {})).status).toBe(
      404,
    );
    expect((await call(BUYER, 'POST', `${BASE}/${id}/purchasers/pur-2/invite`, {})).status).toBe(
      403,
    );
  });
});

describe('reading change orders', () => {
  it('lists an agreement’s change orders for the company and its buyer', async () => {
    const first = await executeOne();
    const second = await request([SIGNATURE_KITCHEN]);
    for (const who of [STAFF, FINANCE, BUYER]) {
      const res = await call(who, 'GET', BASE);
      expect(res.status).toBe(200);
      expect(res.body.map((a: { id: string }) => a.id)).toEqual([first, second]);
    }
    expect((await call(OTHER_BUYER, 'GET', BASE)).status).toBe(404);
    expect((await call(STAFF, 'GET', `${BASE}/${second}`)).body.id).toBe(second);
    expect((await call(STAFF, 'GET', `${BASE}/nope`)).status).toBe(404);
  });

  it('a signing link opens its own change order only', async () => {
    const id = await request();
    await price(id);
    await issue(id);
    const signer = await amendmentSigner(id, 'pur-2');
    expect((await call(signer, 'GET', `${BASE}/${id}`)).body.viewerPurchaserId).toBe('pur-2');
    expect((await call(signer, 'GET', `${BASE}/${id}/pdf`)).status).toBe(200);
    expect((await call(signer, 'GET', BASE)).status).toBe(403);
    expect((await call(signer, 'GET', `${BASE}/current`)).status).toBe(403);
    await repo
      .of('accessKeys')
      .updateOne({ _id: signer.sub }, { $set: { status: AccessKeyStatus.Revoked } });
    expect((await call(signer, 'GET', `${BASE}/${id}`)).status).toBe(404);
  });

  it('serves the executed PDF as stored, and a draft rendered on the fly', async () => {
    const id = await request();
    await price(id);
    const draft = await call(BUYER, 'GET', `${BASE}/${id}/pdf`);
    expect(draft.status).toBe(200);
    expect(draft.headers.get('content-type')).toBe('application/pdf');
    expect(draft.headers.get('content-disposition')).toMatch(/CO-.*-draft\.pdf"$/);
    await issue(id);
    await signAll(id);
    const a = await amendment(id);
    const file = await repo
      .of<AgreementFileDoc>('agreementFiles')
      .findOne({ _id: a.executedPdf!.fileId });
    const pdf = await call(BUYER, 'GET', `${BASE}/${id}/pdf`);
    expect(pdf.headers.get('content-disposition')).toBe(
      `attachment; filename="${a.reference}-executed.pdf"`,
    );
    expect(pdf.headers.get('content-length')).toBe(String(file!.size));
  });

  it('the company sees change orders waiting for it across agreements', async () => {
    const id = await awaitingApproval();
    for (const who of [ADMIN, STAFF, FINANCE]) {
      const res = await call(who, 'GET', '/agreement-amendments?status=awaiting_approval');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ id, afterTotalCents: 57_432_250 })]);
    }
    expect((await call(ADMIN, 'GET', '/agreement-amendments?status=executed')).body).toEqual([]);
    expect((await call(BUYER, 'GET', '/agreement-amendments')).status).toBe(403);
  });
});

describe('GET and PUT /amendment-policy', () => {
  it('the company reads the policy; only an administrator sets it', async () => {
    for (const who of [STAFF, FINANCE, ADMIN]) {
      expect((await call(who, 'GET', '/amendment-policy')).body).toEqual({
        approveCredits: true,
        approveAdjustments: true,
        approveAboveCents: null,
      });
    }
    expect((await call(BUYER, 'GET', '/amendment-policy')).status).toBe(403);
    const lenient = { approveCredits: true, approveAdjustments: false, approveAboveCents: null };
    expect((await call(STAFF, 'PUT', '/amendment-policy', lenient)).status).toBe(403);
    expect((await call(FINANCE, 'PUT', '/amendment-policy', lenient)).status).toBe(403);
    expect(await call(ADMIN, 'PUT', '/amendment-policy', lenient)).toMatchObject({
      status: 200,
      body: lenient,
    });

    const id = await request();
    await price(id, FEE);
    await issue(id);
    expect((await signAll(id)).status).toBe(AmendmentStatus.Executed);
  });
});

describe('amendments in order, on an agreement that never changes', () => {
  it('each amends the one before; the executed agreement, its fingerprint and PDF stay as signed', async () => {
    const agreementBefore = await repo.of('agreements').findOne({ _id: 'agr-1' });
    const fileBefore = await repo.of('agreementFiles').findOne({ _id: 'file-agr' });

    const first = await executeOne();
    const declined = await request([SIGNATURE_KITCHEN]);
    await call(STAFF, 'POST', `${BASE}/${declined}/decline`, {});
    const second = await request([SIGNATURE_KITCHEN]);
    const one = await amendment(first);
    expect(await amendment(second)).toMatchObject({
      number: 2,
      basis: { number: 1, contentHash: one.contentHash },
      before: one.after,
    });
    await price(second);
    await issue(second);
    await signAll(second);

    const current = (await call(BUYER, 'GET', `${BASE}/current`)).body;
    expect(current.state.amendments.map((a: { number: number }) => a.number)).toEqual([1, 2]);
    expect(current.state.totalCents).toBe(56_500_000 + 904_000 + 1_017_000);
    expect(current.selections).toEqual({
      kitchen: { packageId: 'pkg-signature' },
      flooring: { itemIds: ['item-oak'] },
    });

    expect(await repo.of('agreements').findOne({ _id: 'agr-1' })).toEqual(agreementBefore);
    expect(await repo.of('agreementFiles').findOne({ _id: 'file-agr' })).toEqual(fileBefore);
    const original = await call(STAFF, 'GET', '/agreements/agr-1/pdf');
    expect(original.body).toBe('original pdf');
    expect(await repo.of('agreementFiles').countDocuments({ agreementId: 'agr-1' })).toBe(3);
  });

  it('a payment is capped by the amended price', async () => {
    await put('agreementPayments', paymentDoc({ amountCents: 56_500_000 }));
    expect(
      await call(FINANCE, 'POST', '/agreements/agr-1/payments', {
        amountCents: 1,
        receivedOn: '2026-10-30',
        method: 'wire',
      }),
    ).toMatchObject({ status: 422 });
    await executeOne();
    const res = await call(FINANCE, 'POST', '/agreements/agr-1/payments', {
      amountCents: 904_000,
      receivedOn: '2026-10-30',
      method: 'wire',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe(PaymentStatus.Posted);
  });
});

describe('GET /amendments/:id (a change order by itself, for its signing link)', () => {
  it('opens for its own signing link, the company and the buyer, with its agreement', async () => {
    const id = await request();
    await price(id);
    await issue(id);
    const signer = await amendmentSigner(id, 'pur-1');
    const res = await call(signer, 'GET', `/amendments/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, agreementId: 'agr-1', viewerPurchaserId: 'pur-1' });
    expect((await call(STAFF, 'GET', `/amendments/${id}`)).body.id).toBe(id);
    expect((await call(BUYER, 'GET', `/amendments/${id}`)).body).not.toHaveProperty(
      'viewerPurchaserId',
    );
  });

  it('stays closed to other links, other buyers and unknown ids', async () => {
    const id = await request();
    expect((await call(OTHER_BUYER, 'GET', `/amendments/${id}`)).status).toBe(404);
    expect(
      (await call(await amendmentSigner('other', 'pur-1'), 'GET', `/amendments/${id}`)).status,
    ).toBe(404);
    expect((await call(agreementSigner('agr-1', 'pur-1'), 'GET', `/amendments/${id}`)).status).toBe(
      403,
    );
    expect((await call(STAFF, 'GET', '/amendments/nope')).status).toBe(404);
  });
});

describe('money after a change order', () => {
  const ledger = async (who: Principal = FINANCE) =>
    (await call(who, 'GET', '/agreements/agr-1/payments')).body;

  it('the closing line follows a closing date the change order moves', async () => {
    const id = await throughSignatures({ closingDate: '2027-06-30' });
    expect((await amendment(id)).closingDate).toBe('2027-06-30');
    const closing = (await ledger()).schedule.lines.at(-1);
    expect(closing).toMatchObject({ kind: 'closing', dueDate: '2027-06-30', status: 'upcoming' });
    expect((await call(BUYER, 'GET', `${BASE}/current`)).body.state.terms.closingDate).toBe(
      '2027-06-30',
    );
  });

  it('an instalment the change order adds is due, and overdue once its day has passed', async () => {
    await throughSignatures({
      deposits: [{ label: 'Upgrade payment', amountCents: 500_000, dueDate: '2026-10-15' }],
    });
    const { schedule } = await ledger();
    expect(
      schedule.lines.map((l: { label?: string; status: string }) => [l.label, l.status]),
    ).toEqual([
      ['on signing', 'due'],
      ['Upgrade payment', 'overdue'],
      [undefined, 'upcoming'],
    ]);
    expect(schedule.totals).toMatchObject({
      totalCents: 57_404_000,
      depositCents: 3_000_000,
      overdueCents: 500_000,
      outstandingCents: 57_404_000,
    });
  });

  it('a price cut below what was received becomes a credit, which a refund settles', async () => {
    await put('agreementPayments', paymentDoc({ _id: 'pay-all', amountCents: 56_500_000 }));
    const id = await request([ADD_OAK]);
    const [oak] = (await amendment(id)).changes;
    await price(id, {
      decisions: [{ changeId: oak!.id, approved: false }],
      adjustments: [{ label: 'Lot grading credit', amountCents: -1_000_000 }],
    });
    await issue(id);
    await signAll(id);
    expect((await approve(id)).body.status).toBe(AmendmentStatus.Executed);

    const { schedule } = await ledger();
    expect(schedule.totals).toMatchObject({
      totalCents: 55_370_000,
      netPaidCents: 56_500_000,
      outstandingCents: 0,
      creditCents: 1_130_000,
    });
    expect(schedule.lines.every((l: { remainingCents: number }) => l.remainingCents === 0)).toBe(
      true,
    );
    expect((await call(STAFF, 'GET', '/agreements')).body[0].payments).toMatchObject({
      outstandingCents: 0,
      creditCents: 1_130_000,
    });
    expect((await thread()).slice(-2)).toEqual([
      expect.stringContaining('now stands at $553,700.'),
      'Payments received ($565,000) exceed the new price: $11,300 is owed back to the buyer.',
    ]);

    const refund = await call(FINANCE, 'POST', '/agreements/agr-1/payments', {
      kind: PaymentKind.Refund,
      amountCents: 1_130_000,
      receivedOn: '2026-10-31',
      method: 'wire',
    });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect((await ledger()).schedule.totals).toMatchObject({
      netPaidCents: 55_370_000,
      outstandingCents: 0,
      creditCents: 0,
    });
    expect((await call(STAFF, 'GET', '/agreements')).body[0].payments).not.toHaveProperty(
      'creditCents',
    );
  });

  it('the ledger tells the company and the buyer how the price changed', async () => {
    expect(await ledger()).not.toHaveProperty('priceChanges');
    const first = await executeOne();
    const one = await amendment(first);
    const changes = [
      {
        number: 1,
        reference: one.reference,
        executedAt: one.executedAt,
        fromCents: 56_500_000,
        toCents: 57_404_000,
      },
    ];
    expect((await ledger()).priceChanges).toEqual(changes);
    expect((await ledger(BUYER)).priceChanges).toEqual(changes);
  });
});
