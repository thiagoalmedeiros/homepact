import {
  AccessResourceType,
  AgreementStatus,
  ChangeDecision,
  ChangeError,
  ChangeRequestStatus,
  InventoryStatus,
  Party,
  ProposalStatus,
  Role,
  type Change,
} from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccessKey } from '../../../src/modules/access-keys/keys.js';
import {
  askingPriceAdjustment,
  loadHouse,
  price,
  pricingContext,
  pricingExtras,
} from '../../../src/modules/houses/pricing.js';
import { toDetail } from '../../../src/modules/houses/store.js';
import { voidAgreement } from '../../../src/modules/agreements/store.js';
import { proposalRoutes } from '../../../src/modules/proposals/routes.js';
import { applyReferral } from '../../../src/modules/referrals/store.js';
import { carriedTaxRate, resolveTaxRate } from '../../../src/modules/sales-tax/store.js';
import {
  addMessage,
  authorName,
  describeChange,
  loadDetail,
  loadProposalFor,
  packageContents,
  partyOf,
  toProposal,
  type ProposalDoc,
} from '../../../src/modules/proposals/store.js';
import { unprocessable } from '../../../src/http/errors.js';
import {
  accessKeyDoc,
  catalog,
  changeRequestDoc,
  houseDoc,
  inventoryDoc,
  proposalDoc,
  quote,
  revisionDoc,
  userDoc,
} from '../../support/fixtures.js';
import {
  BUYER,
  COMPANY_TENANT,
  NOW,
  NOW_ISO,
  STAFF,
  keyHolder,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockContext,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('@homepact/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@homepact/shared')>()),
  applyChanges: vi.fn(),
}));
vi.mock('../../../src/data/ids.js', () => ({
  newId: vi.fn(),
  reference: vi.fn(() => 'P-TEST-0001'),
}));
vi.mock('../../../src/modules/access-keys/keys.js', () => ({ createAccessKey: vi.fn() }));
vi.mock('../../../src/modules/agreements/store.js', () => ({
  voidAgreement: vi.fn(),
  agreementOfProposal: vi.fn(),
}));
vi.mock('../../../src/modules/houses/pricing.js', () => ({
  askingPriceAdjustment: vi.fn(),
  loadHouse: vi.fn(),
  price: vi.fn(),
  pricingContext: vi.fn(),
  pricingExtras: vi.fn(),
}));
vi.mock('../../../src/modules/houses/store.js', () => ({ toDetail: vi.fn() }));
vi.mock('../../../src/modules/referrals/store.js', () => ({ applyReferral: vi.fn() }));
vi.mock('../../../src/modules/sales-tax/store.js', () => ({
  carriedTaxRate: vi.fn(),
  resolveTaxRate: vi.fn(),
}));
vi.mock('../../../src/modules/proposals/store.js', () => ({
  addMessage: vi.fn(),
  authorName: vi.fn(),
  describeChange: vi.fn(),
  loadDetail: vi.fn(),
  loadProposalFor: vi.fn(),
  packageContents: vi.fn(),
  partyOf: vi.fn(),
  toProposal: vi.fn(),
}));
const { applyChanges } = await import('@homepact/shared');
const ids = await import('../../../src/data/ids.js');

const pc = { catalog: catalog(), currency: 'CAD' as const };
const ONTARIO = { code: 'ON', name: 'Ontario', components: [{ label: 'HST', ratePercent: 13 }] };
const REFERRAL = {
  programId: 'prog-1',
  programName: 'Refer a friend',
  referrerName: 'Jo Homeowner',
  creditCents: 200_000,
};
const EXTRAS = { tax: ONTARIO, referral: REFERRAL };
const contents = vi.fn();
let h: Harness;
let repo: MockRepo;
let scene: Scene;
let ctx: MockContext;
let current: ProposalDoc;

const messages = () => vi.mocked(addMessage).mock.calls.map((c) => [c[2], c[4]]);
const proposals = () => repo.col('proposals');

beforeEach(async () => {
  repo = mockRepo();
  ctx = mockContext();
  scene = { tenant: COMPANY_TENANT, repo, principal: STAFF };
  current = proposalDoc();
  let n = 0;
  vi.mocked(ids.newId).mockImplementation(() => `id-${++n}`);
  vi.mocked(loadProposalFor).mockImplementation(async () => current);
  vi.mocked(loadDetail).mockImplementation(
    async (_req, doc) => ({ detail: doc._id, status: doc.status }) as never,
  );
  vi.mocked(toProposal).mockImplementation((d) => ({ proposal: d._id }) as never);
  vi.mocked(pricingContext).mockResolvedValue(pc);
  vi.mocked(pricingExtras).mockResolvedValue(EXTRAS);
  vi.mocked(carriedTaxRate).mockResolvedValue(null);
  vi.mocked(loadHouse).mockResolvedValue(houseDoc());
  vi.mocked(price).mockReturnValue(quote());
  vi.mocked(askingPriceAdjustment).mockReturnValue([]);
  vi.mocked(packageContents).mockReturnValue(contents);
  vi.mocked(applyChanges).mockImplementation((selections) => ({
    ...selections,
    applied: { itemIds: [] },
  }));
  vi.mocked(describeChange).mockImplementation((c) => `label:${c.type}`);
  vi.mocked(partyOf).mockReturnValue(Party.Seller);
  vi.mocked(authorName).mockReturnValue('Bea Buyer');
  vi.mocked(createAccessKey).mockResolvedValue({
    key: 'invite-key',
    doc: accessKeyDoc({ _id: 'key-9' }),
  });
  proposals().findOneAndUpdate.mockImplementation(async (_f, u: { $set: object }) => ({
    ...current,
    ...u.$set,
  }));
  repo.col('revisions').findOne.mockResolvedValue(revisionDoc());
  h = await serveRouter(proposalRoutes(ctx), scene);
});
afterEach(() => h.close());

it('every endpoint requires a signed-in user', async () => {
  delete scene.principal;
  for (const [method, path] of [
    ['GET', '/'],
    ['POST', '/'],
    ['GET', '/proposal-1'],
    ['POST', '/proposal-1/sign'],
  ] as const) {
    expect((await h.call(method, path, {})).status).toBe(401);
  }
});

it('seller actions are staff-only and buyer actions buyer-only', async () => {
  scene.principal = BUYER;
  for (const path of [
    '',
    '/proposal-1/revisions',
    '/proposal-1/lock',
    '/proposal-1/assign',
    '/proposal-1/withdraw',
    '/proposal-1/change-requests/cr-1/decision',
  ]) {
    expect((await h.call('POST', path || '/', {})).status, path).toBe(403);
  }
  scene.principal = STAFF;
  for (const path of [
    '/proposal-1/change-requests',
    '/proposal-1/change-requests/cr-1/withdraw',
    '/proposal-1/sign',
    '/proposal-1/decline',
  ]) {
    expect((await h.call('POST', path, {})).status, path).toBe(403);
  }
  expect(loadProposalFor).not.toHaveBeenCalled();
});

describe('POST / (seller creates a proposal)', () => {
  const planBody = {
    houseId: 'house-1',
    selections: { kitchen: { packageId: 'pkg-signature' } },
    adjustments: [{ label: 'Promo', amountCents: -1_000 }],
    buyer: { name: 'Bea Buyer', email: 'bea@buyer.test' },
    note: 'Welcome!',
  };

  it('prices a floor-plan configuration and opens it with a one-time invite key', async () => {
    vi.mocked(price).mockReturnValue(quote({ totalCents: 50_900_000 }));
    const res = await h.call('POST', '/', planBody);
    expect(res).toMatchObject({
      status: 201,
      body: { proposal: { proposal: 'id-1' }, accessKey: 'invite-key' },
    });
    expect(loadHouse).toHaveBeenCalledWith(expect.anything(), 'house-1');
    expect(pricingExtras).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining(planBody),
    );
    expect(price).toHaveBeenCalledWith(
      houseDoc(),
      pc,
      planBody.selections,
      planBody.adjustments,
      EXTRAS,
    );
    expect(createAccessKey).toHaveBeenCalledWith(repo, AccessResourceType.Proposal, 'id-1', {
      createdBy: 'staff-1',
      now: NOW,
    });
    expect(proposals().insertOne).toHaveBeenCalledWith({
      _id: 'id-1',
      reference: 'P-TEST-0001',
      kind: 'plan',
      houseId: 'house-1',
      houseName: 'The Aspen',
      imageUrl: 'https://img.test/aspen.jpg',
      locked: false,
      buyer: planBody.buyer,
      repId: 'staff-1',
      repName: 'Sam Staff',
      status: ProposalStatus.Proposed,
      currentRevision: 1,
      currentTotalCents: 50_900_000,
      currency: 'CAD',
      accessKeyId: 'key-9',
      createdAt: NOW_ISO,
      lastActivityAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    expect(repo.col('revisions').insertOne).toHaveBeenCalledWith({
      _id: 'id-2',
      proposalId: 'id-1',
      number: 1,
      selections: planBody.selections,
      quote: quote({ totalCents: 50_900_000 }),
      authorName: 'Sam Staff',
      createdAt: NOW_ISO,
      note: 'Welcome!',
    });
    expect(messages()).toEqual([
      [Party.System, 'Sam Staff proposed The Aspen: revision 1, $509,000.'],
      [Party.Seller, 'Welcome!'],
    ]);
  });

  it('only pre-existing homes can be locked; plan or home must be chosen', async () => {
    expect(await h.call('POST', '/', { ...planBody, locked: true })).toMatchObject({
      status: 422,
      body: { error: 'Only pre-existing homes can be locked' },
    });
    expect((await h.call('POST', '/', { buyer: {} })).status).toBe(400);
    expect(proposals().insertOne).not.toHaveBeenCalled();
  });

  it('invalid configurations are refused before anything is stored', async () => {
    vi.mocked(price).mockImplementation(() => {
      throw unprocessable('Package is not in "Kitchen"');
    });
    expect((await h.call('POST', '/', planBody)).status).toBe(422);
    expect(createAccessKey).not.toHaveBeenCalled();
  });

  describe('from a pre-existing home', () => {
    const homeBody = { inventoryHomeId: 'home-1', buyer: { name: 'Bea' } };

    it('proposes it at its asking price, locked by default', async () => {
      repo.col('inventoryHomes').findOne.mockResolvedValue(inventoryDoc());
      const asking = [{ label: 'Pre-existing home price', amountCents: 100 }];
      vi.mocked(price)
        .mockReturnValueOnce(quote({ totalCents: 1 }))
        .mockReturnValue(quote({ totalCents: 2 }));
      vi.mocked(askingPriceAdjustment).mockReturnValue(asking);

      expect((await h.call('POST', '/', homeBody)).status).toBe(201);
      expect(repo.col('inventoryHomes').findOne).toHaveBeenCalledWith({ _id: 'home-1' });
      expect(askingPriceAdjustment).toHaveBeenCalledWith(quote({ totalCents: 1 }), 61_000_000);
      expect(price).toHaveBeenNthCalledWith(1, houseDoc(), pc, inventoryDoc().selections);
      expect(price).toHaveBeenLastCalledWith(
        houseDoc(),
        pc,
        inventoryDoc().selections,
        asking,
        EXTRAS,
      );
      expect(proposals().insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'inventory',
          inventoryHomeId: 'home-1',
          address: '12 Main St',
          community: 'Riverside',
          imageUrl: 'https://img.test/home.jpg',
          locked: true,
          currentTotalCents: 2,
        }),
      );
      expect(messages()[0]![1]).toContain('at 12 Main St');
      expect(messages()).toHaveLength(1);
    });

    it('the seller can unlock it up front', async () => {
      repo.col('inventoryHomes').findOne.mockResolvedValue(inventoryDoc());
      await h.call('POST', '/', { ...homeBody, locked: false });
      expect(proposals().insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ locked: false }),
      );
    });

    it('is a 404 when missing and a 409 when already sold', async () => {
      expect((await h.call('POST', '/', homeBody)).status).toBe(404);
      repo
        .col('inventoryHomes')
        .findOne.mockResolvedValue(inventoryDoc({ status: InventoryStatus.Sold }));
      expect(await h.call('POST', '/', homeBody)).toMatchObject({
        status: 409,
        body: { error: 'This home is already sold' },
      });
    });
  });
});

describe('POST /quote (what a new proposal would cost)', () => {
  it('prices a plan or a home exactly as creating the proposal would, storing nothing', async () => {
    vi.mocked(price).mockReturnValue(quote({ totalCents: 56_613_000 }));
    const body = {
      houseId: 'house-1',
      selections: { kitchen: { packageId: 'pkg-signature' } },
      taxRegion: 'on',
      referral: { programId: 'prog-1', referrerName: 'Jo Homeowner' },
    };
    expect(await h.call('POST', '/quote', body)).toMatchObject({
      status: 200,
      body: quote({ totalCents: 56_613_000 }),
    });
    expect(pricingExtras).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taxRegion: 'ON', referral: body.referral }),
    );
    expect(price).toHaveBeenCalledWith(houseDoc(), pc, body.selections, [], EXTRAS);
    expect(proposals().insertOne).not.toHaveBeenCalled();
    expect(createAccessKey).not.toHaveBeenCalled();

    repo.col('inventoryHomes').findOne.mockResolvedValue(inventoryDoc());
    expect((await h.call('POST', '/quote', { inventoryHomeId: 'home-1' })).status).toBe(200);
    expect(price).toHaveBeenLastCalledWith(houseDoc(), pc, inventoryDoc().selections, [], EXTRAS);
  });

  it('is staff-only and needs a plan or a home', async () => {
    expect((await h.call('POST', '/quote', {})).status).toBe(400);
    scene.principal = BUYER;
    expect((await h.call('POST', '/quote', { houseId: 'house-1' })).status).toBe(403);
  });
});

describe('GET / (list)', () => {
  const listFilter = () => proposals().find.mock.calls[0]![0];

  it('staff filter by status and their own proposals', async () => {
    proposals().find.mockResolvedValue([proposalDoc()]);
    expect((await h.call('GET', '/?status=proposed&mine=1')).body).toEqual([
      { proposal: 'proposal-1' },
    ]);
    expect(listFilter()).toEqual({ status: ProposalStatus.Proposed, repId: 'staff-1' });
    expect(proposals().find.mock.calls[0]![1]).toEqual({
      sort: { lastActivityAt: -1 },
      limit: 300,
    });
    proposals().find.mockClear();
    await h.call('GET', '/');
    expect(listFilter()).toEqual({});
    expect((await h.call('GET', '/?status=bogus')).status).toBe(400);
  });

  it('buyers see their own, key holders only the proposal their key opens', async () => {
    scene.principal = BUYER;
    await h.call('GET', '/');
    expect(listFilter()).toEqual({ buyerUserId: 'buyer-1' });
    proposals().find.mockClear();
    scene.principal = keyHolder('proposal-7');
    await h.call('GET', '/');
    expect(listFilter()).toEqual({ _id: 'proposal-7' });
  });

  it('anyone else gets an empty list without a query', async () => {
    const { resource: _r, ...holderWithoutResource } = keyHolder('x');
    scene.principal = holderWithoutResource;
    expect((await h.call('GET', '/')).body).toEqual([]);
    expect(proposals().find).not.toHaveBeenCalled();
  });
});

describe('reading a proposal', () => {
  it('GET /:id returns the detail of a proposal the caller may see', async () => {
    expect((await h.call('GET', '/proposal-1')).body).toEqual({
      detail: 'proposal-1',
      status: ProposalStatus.Proposed,
    });
    expect(loadProposalFor).toHaveBeenCalledWith(expect.anything(), 'proposal-1');
  });

  it('GET /:id is a 404 when the caller may not see it', async () => {
    vi.mocked(loadProposalFor).mockRejectedValue(
      Object.assign(new Error('Not found'), { status: 404, expose: true }),
    );
    expect((await h.call('GET', '/proposal-1')).status).toBe(404);
  });

  it('GET /:id/options prices every catalog option for the plan', async () => {
    vi.mocked(toDetail).mockReturnValue({ options: true } as never);
    expect((await h.call('GET', '/proposal-1/options')).body).toEqual({ options: true });
    expect(toDetail).toHaveBeenCalledWith(houseDoc(), pc.catalog, 'CAD');
  });
});

describe('POST /:id/messages', () => {
  it('adds a message as the caller party and bumps the activity', async () => {
    const res = await h.call('POST', '/proposal-1/messages', { body: '  Can we talk?  ' });
    expect(res.status).toBe(201);
    expect(addMessage).toHaveBeenCalledWith(
      repo,
      'proposal-1',
      Party.Seller,
      'Bea Buyer',
      'Can we talk?',
      NOW,
    );
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1' },
      { $set: { lastActivityAt: NOW_ISO, updatedAt: NOW_ISO } },
    );
    expect((await h.call('POST', '/proposal-1/messages', { body: ' ' })).status).toBe(400);
  });
});

describe('POST /:id/revisions (seller revises directly)', () => {
  const body = { selections: { kitchen: { packageId: 'pkg-signature' } }, note: 'As discussed' };

  it('claims the next revision number atomically and records it', async () => {
    vi.mocked(price).mockReturnValue(quote({ totalCents: 51_000_000 }));
    expect((await h.call('POST', '/proposal-1/revisions', body)).status).toBe(201);
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1', status: ProposalStatus.Proposed, currentRevision: 1 },
      {
        $set: {
          status: ProposalStatus.Proposed,
          currentRevision: 2,
          currentTotalCents: 51_000_000,
          lastActivityAt: NOW_ISO,
          updatedAt: NOW_ISO,
        },
      },
    );
    expect(repo.col('revisions').insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'proposal-1', number: 2, note: 'As discussed' }),
    );
    expect(messages()).toEqual([
      [Party.System, 'Sam Staff sent revision 2: $510,000.'],
      [Party.Seller, 'As discussed'],
    ]);
  });

  it('keeps the province and the referral of the current revision unless told', async () => {
    const taxed = quote({
      referral: REFERRAL,
      tax: {
        regionCode: 'ON',
        regionName: 'Ontario',
        lines: [{ label: 'HST', ratePercent: 13, amountCents: 1 }],
        totalCents: 1,
      },
    });
    repo.col('revisions').findOne.mockResolvedValue(revisionDoc({ quote: taxed }));
    vi.mocked(carriedTaxRate).mockResolvedValue(ONTARIO);
    await h.call('POST', '/proposal-1/revisions', body);
    expect(carriedTaxRate).toHaveBeenCalledWith(repo, taxed.tax);
    expect(resolveTaxRate).not.toHaveBeenCalled();
    expect(applyReferral).not.toHaveBeenCalled();
    expect(price).toHaveBeenCalledWith(houseDoc(), pc, body.selections, [], {
      tax: ONTARIO,
      referral: REFERRAL,
    });
  });

  it('the seller can change the province and the referral, or remove them', async () => {
    const base = quote({ referral: REFERRAL });
    repo.col('revisions').findOne.mockResolvedValue(revisionDoc({ quote: base }));
    const quebec = { ...ONTARIO, code: 'QC', name: 'Quebec' };
    const other = { ...REFERRAL, referrerName: 'Sam Neighbour' };
    vi.mocked(resolveTaxRate).mockResolvedValue(quebec);
    vi.mocked(applyReferral).mockResolvedValue(other);
    const referral = { programId: 'prog-1', referrerName: 'Sam Neighbour' };
    await h.call('POST', '/proposal-1/revisions', { ...body, taxRegion: 'qc', referral });
    expect(resolveTaxRate).toHaveBeenCalledWith(repo, 'QC', undefined);
    expect(applyReferral).toHaveBeenCalledWith(repo, referral, REFERRAL);
    expect(price).toHaveBeenLastCalledWith(houseDoc(), pc, body.selections, [], {
      tax: quebec,
      referral: other,
    });

    vi.mocked(resolveTaxRate).mockResolvedValue(null);
    await h.call('POST', '/proposal-1/revisions', { ...body, taxRegion: null, referral: null });
    expect(resolveTaxRate).toHaveBeenLastCalledWith(repo, null, undefined);
    expect(price).toHaveBeenLastCalledWith(houseDoc(), pc, body.selections, [], {
      tax: null,
      referral: null,
    });
  });

  it('previews a revision without sending it', async () => {
    vi.mocked(price).mockReturnValue(quote({ totalCents: 57_630_000 }));
    expect(await h.call('POST', '/proposal-1/revisions/preview', body)).toMatchObject({
      status: 200,
      body: quote({ totalCents: 57_630_000 }),
    });
    expect(proposals().findOneAndUpdate).not.toHaveBeenCalled();
    expect(repo.col('revisions').insertOne).not.toHaveBeenCalled();
    expect(messages()).toEqual([]);
    scene.principal = BUYER;
    expect((await h.call('POST', '/proposal-1/revisions/preview', body)).status).toBe(403);
  });

  it('waits for an open change request, refuses closed proposals and lost races', async () => {
    current = proposalDoc({ status: ProposalStatus.ChangesRequested });
    expect(await h.call('POST', '/proposal-1/revisions', body)).toMatchObject({
      status: 409,
      body: { error: 'Respond to the buyer’s change request first' },
    });
    current = proposalDoc({ status: ProposalStatus.Declined });
    expect((await h.call('POST', '/proposal-1/revisions', body)).body).toEqual({
      error: 'This proposal is closed',
    });
    current = proposalDoc();
    proposals().findOneAndUpdate.mockResolvedValue(null);
    expect((await h.call('POST', '/proposal-1/revisions', body)).body).toEqual({
      error: 'The proposal changed meanwhile; reload and try again',
    });
    expect(repo.col('revisions').insertOne).not.toHaveBeenCalled();
  });
});

describe('POST /:id/revisions on a signed proposal (a price change)', () => {
  const body = { selections: { kitchen: { packageId: 'pkg-signature' } } };
  beforeEach(() => {
    current = proposalDoc({ status: ProposalStatus.Signed, agreementId: 'agr-1' });
    repo.col('agreements').findOne.mockResolvedValue({
      _id: 'agr-1',
      reference: 'A-TEST-0001',
      status: AgreementStatus.UnderReview,
      purchasers: [],
    });
    vi.mocked(price).mockReturnValue(quote({ totalCents: 51_000_000 }));
  });

  it('voids the purchase agreement and sends the proposal back to negotiation', async () => {
    expect((await h.call('POST', '/proposal-1/revisions', body)).status).toBe(201);
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1', status: ProposalStatus.Signed, currentRevision: 1 },
      {
        $set: {
          status: ProposalStatus.Proposed,
          currentRevision: 2,
          currentTotalCents: 51_000_000,
          lastActivityAt: NOW_ISO,
          updatedAt: NOW_ISO,
        },
        $unset: { signature: '', agreementId: '' },
      },
    );
    expect(voidAgreement).toHaveBeenCalledWith(
      repo,
      expect.objectContaining({ _id: 'agr-1' }),
      NOW,
      { reason: 'The price of the signed proposal changed; this agreement is void' },
    );
    expect(ctx.signatures.revoke).toHaveBeenCalledWith(
      { repo, now: NOW, actorId: 'staff-1' },
      { agreementId: 'agr-1' },
    );
    expect(messages()).toEqual([
      [
        Party.System,
        'The price changed to $510,000, so purchase agreement A-TEST-0001 is void and this proposal is back in negotiation.',
      ],
      [Party.System, 'Sam Staff sent revision 2: $510,000.'],
    ]);
  });

  it('puts a pre-existing home back on the market', async () => {
    current = proposalDoc({
      status: ProposalStatus.Signed,
      agreementId: 'agr-1',
      kind: 'inventory',
      inventoryHomeId: 'home-1',
    });
    await h.call('POST', '/proposal-1/revisions', body);
    expect(repo.col('inventoryHomes').updateOne).toHaveBeenCalledWith(
      { _id: 'home-1', status: { $ne: InventoryStatus.Sold } },
      { $set: { status: InventoryStatus.Available, updatedAt: NOW_ISO } },
    );
  });

  it('an executed agreement closes the sale: the price can no longer change', async () => {
    repo
      .col('agreements')
      .findOne.mockResolvedValue({ _id: 'agr-1', status: AgreementStatus.Executed });
    expect(await h.call('POST', '/proposal-1/revisions', body)).toMatchObject({
      status: 409,
      body: { error: 'The purchase agreement is executed; this sale can no longer be re-priced' },
    });
    expect(proposals().findOneAndUpdate).not.toHaveBeenCalled();
    expect(voidAgreement).not.toHaveBeenCalled();
  });

  it('a signed proposal without an agreement simply gets a new revision', async () => {
    current = proposalDoc({ status: ProposalStatus.Signed });
    expect((await h.call('POST', '/proposal-1/revisions', body)).status).toBe(201);
    expect(voidAgreement).not.toHaveBeenCalled();
    expect(messages()).toEqual([[Party.System, 'Sam Staff sent revision 2: $510,000.']]);
  });
});

describe('POST /:id/lock', () => {
  beforeEach(() => {
    current = proposalDoc({ kind: 'inventory', locked: false });
  });

  it('locks or unlocks a pre-existing home and tells the buyer', async () => {
    expect((await h.call('POST', '/proposal-1/lock', { locked: true })).status).toBe(200);
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1' },
      { $set: { locked: true, lastActivityAt: NOW_ISO, updatedAt: NOW_ISO } },
    );
    await h.call('POST', '/proposal-1/lock', { locked: false });
    expect(messages()).toEqual([
      [Party.System, 'This home is now offered as-is: changes can no longer be requested.'],
      [Party.System, 'Changes can now be requested for this home.'],
    ]);
  });

  it('refuses plans, locking over an open request, and closed proposals', async () => {
    current = proposalDoc({ kind: 'plan' });
    expect((await h.call('POST', '/proposal-1/lock', { locked: true })).status).toBe(422);
    current = proposalDoc({ kind: 'inventory', status: ProposalStatus.ChangesRequested });
    expect((await h.call('POST', '/proposal-1/lock', { locked: true })).status).toBe(409);
    expect((await h.call('POST', '/proposal-1/lock', { locked: false })).status).toBe(200);
    current = proposalDoc({ kind: 'inventory', status: ProposalStatus.Declined });
    expect((await h.call('POST', '/proposal-1/lock', { locked: false })).body).toEqual({
      error: 'This proposal is closed',
    });
  });
});

describe('POST /:id/assign', () => {
  it('assigns an active colleague as the sales rep', async () => {
    repo
      .col('users')
      .findOne.mockResolvedValue(
        userDoc({ _id: 'admin-1', name: 'Alex Admin', role: Role.CompanyAdmin }),
      );
    expect((await h.call('POST', '/proposal-1/assign', { repId: 'admin-1' })).status).toBe(200);
    expect(repo.col('users').findOne).toHaveBeenCalledWith({
      _id: 'admin-1',
      active: true,
      role: { $in: [Role.CompanyAdmin, Role.CompanyStaff] },
    });
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1' },
      { $set: { repId: 'admin-1', repName: 'Alex Admin', updatedAt: NOW_ISO } },
    );
    expect(messages()).toEqual([[Party.System, 'Alex Admin is now your sales representative.']]);
  });

  it('an unknown rep is a 422', async () => {
    expect(await h.call('POST', '/proposal-1/assign', { repId: 'nobody' })).toMatchObject({
      status: 422,
      body: { error: 'Sales rep not found in this company' },
    });
  });
});

describe('POST /:id/withdraw (seller)', () => {
  it('withdraws an active proposal and closes open change requests', async () => {
    expect((await h.call('POST', '/proposal-1/withdraw')).body).toEqual({
      detail: 'proposal-1',
      status: ProposalStatus.Withdrawn,
    });
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'proposal-1',
        status: { $in: [ProposalStatus.Proposed, ProposalStatus.ChangesRequested] },
      },
      {
        $set: { status: ProposalStatus.Withdrawn, lastActivityAt: NOW_ISO, updatedAt: NOW_ISO },
        $unset: { openChangeRequestId: '' },
      },
    );
    expect(repo.col('changeRequests').updateMany).toHaveBeenCalledWith(
      { proposalId: 'proposal-1', status: ChangeRequestStatus.Open },
      { $set: { status: ChangeRequestStatus.Withdrawn } },
    );
    expect(messages()).toEqual([[Party.System, 'Sam Staff withdrew this proposal.']]);
  });

  it('a closed proposal is a 409', async () => {
    proposals().findOneAndUpdate.mockResolvedValue(null);
    expect((await h.call('POST', '/proposal-1/withdraw')).status).toBe(409);
    expect(repo.col('changeRequests').updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /:id/change-requests/preview', () => {
  const changes: Change[] = [
    { type: 'set_package', areaSlug: 'kitchen', packageId: 'pkg-signature' },
    { type: 'add_item', areaSlug: 'flooring', itemId: 'item-oak' },
  ];

  it('prices all changes together and each one alone against the current revision', async () => {
    scene.principal = BUYER;
    vi.mocked(price)
      .mockReturnValueOnce(quote({ totalCents: 51_700_000 })) // all together
      .mockReturnValueOnce(quote({ totalCents: 50_900_000 })) // first alone
      .mockReturnValueOnce(quote({ totalCents: 50_800_000 })); // second alone
    const res = await h.call('POST', '/proposal-1/change-requests/preview', { changes });
    expect(res.body).toEqual({
      quote: quote({ totalCents: 51_700_000 }),
      changes: [
        { label: 'label:set_package', deltaCents: 900_000 },
        { label: 'label:add_item', deltaCents: 800_000 },
      ],
    });
    expect(repo.col('revisions').findOne).toHaveBeenCalledWith({
      proposalId: 'proposal-1',
      number: 1,
    });
    expect(applyChanges).toHaveBeenCalledWith(revisionDoc().selections, changes, contents);
    expect(applyChanges).toHaveBeenCalledWith(revisionDoc().selections, [changes[0]], contents);
    expect(carriedTaxRate).toHaveBeenCalledWith(repo, undefined);
    expect(price).toHaveBeenCalledWith(houseDoc(), pc, expect.anything(), [], {
      tax: null,
      referral: null,
    });
  });

  it('each change is priced before tax, like the options; the total includes the tax', async () => {
    const withTax = (subtotalCents: number) =>
      quote({
        subtotalCents,
        totalCents: Math.round(subtotalCents * 1.13),
        tax: {
          regionCode: 'ON',
          regionName: 'Ontario',
          lines: [{ label: 'HST', ratePercent: 13, amountCents: Math.round(subtotalCents * 0.13) }],
          totalCents: Math.round(subtotalCents * 0.13),
        },
      });
    repo.col('revisions').findOne.mockResolvedValue(revisionDoc({ quote: withTax(50_000_000) }));
    vi.mocked(carriedTaxRate).mockResolvedValue(ONTARIO);
    vi.mocked(price)
      .mockReturnValueOnce(withTax(51_700_000))
      .mockReturnValueOnce(withTax(50_900_000))
      .mockReturnValueOnce(withTax(50_800_000));
    const res = await h.call('POST', '/proposal-1/change-requests/preview', { changes });
    expect(res.body.quote.totalCents).toBe(58_421_000);
    expect(res.body.changes.map((c: { deltaCents: number }) => c.deltaCents)).toEqual([
      900_000, 800_000,
    ]);
  });

  it('only the seller can try other adjustments in the preview', async () => {
    const adjustments = [{ label: 'Goodwill', amountCents: -500 }];
    await h.call('POST', '/proposal-1/change-requests/preview', { changes, adjustments });
    expect(vi.mocked(price).mock.calls[0]![3]).toEqual(adjustments);
    expect(vi.mocked(price).mock.calls[1]![3]).toEqual([]);
    vi.mocked(price).mockClear();
    scene.principal = BUYER;
    await h.call('POST', '/proposal-1/change-requests/preview', { changes, adjustments });
    expect(vi.mocked(price).mock.calls[0]![3]).toEqual([]);
  });

  it('a change that only works with another one gets no delta of its own', async () => {
    vi.mocked(applyChanges)
      .mockReturnValueOnce({})
      .mockImplementationOnce(() => {
        throw new ChangeError('needs the other change');
      });
    const res = await h.call('POST', '/proposal-1/change-requests/preview', {
      changes: [changes[1]],
    });
    expect(res.body.changes).toEqual([{ label: 'label:add_item', deltaCents: 0 }]);
  });

  it('a change the engine refuses is a 422, a locked home a 403 for buyers', async () => {
    vi.mocked(applyChanges).mockImplementationOnce(() => {
      throw new ChangeError('Item is not in the package');
    });
    expect(await h.call('POST', '/proposal-1/change-requests/preview', { changes })).toMatchObject({
      status: 422,
      body: { error: 'Item is not in the package' },
    });
    vi.mocked(applyChanges).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect((await h.call('POST', '/proposal-1/change-requests/preview', { changes })).status).toBe(
      500,
    );

    current = proposalDoc({ locked: true });
    expect((await h.call('POST', '/proposal-1/change-requests/preview', { changes })).status).toBe(
      200,
    );
    scene.principal = BUYER;
    expect((await h.call('POST', '/proposal-1/change-requests/preview', { changes })).status).toBe(
      403,
    );
  });

  it('a missing current revision is a 404', async () => {
    repo.col('revisions').findOne.mockResolvedValue(null);
    expect(await h.call('POST', '/proposal-1/change-requests/preview', { changes })).toMatchObject({
      status: 404,
      body: { error: 'Revision not found' },
    });
  });
});

describe('POST /:id/change-requests (buyer asks for changes)', () => {
  const body = {
    baseRevision: 1,
    changes: [{ type: 'remove_item', areaSlug: 'kitchen', itemId: 'item-hood' }],
    note: 'Please',
  };

  beforeEach(() => {
    scene.principal = BUYER;
  });

  it('opens a change request on the current revision and hands the turn to the seller', async () => {
    vi.mocked(price)
      .mockReturnValueOnce(quote({ totalCents: 49_850_000 }))
      .mockReturnValueOnce(quote({ totalCents: 49_850_000 }));
    const res = await h.call('POST', '/proposal-1/change-requests', body);
    expect(res).toMatchObject({ status: 201, body: { status: ProposalStatus.ChangesRequested } });
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1', status: ProposalStatus.Proposed, currentRevision: 1, locked: false },
      {
        $set: {
          status: ProposalStatus.ChangesRequested,
          openChangeRequestId: 'id-1',
          lastActivityAt: NOW_ISO,
          updatedAt: NOW_ISO,
        },
      },
    );
    expect(repo.col('changeRequests').insertOne).toHaveBeenCalledWith({
      _id: 'id-1',
      proposalId: 'proposal-1',
      baseRevision: 1,
      changes: [
        { id: 'id-2', change: body.changes[0], label: 'label:remove_item', deltaCents: -150_000 },
      ],
      previewTotalCents: 49_850_000,
      status: ChangeRequestStatus.Open,
      authorName: 'Bea Buyer',
      createdAt: NOW_ISO,
      note: 'Please',
    });
    expect(messages()).toEqual([
      [Party.System, 'Bea Buyer requested 1 change to revision 1 ($498,500 if all approved).'],
      [Party.Buyer, 'Please'],
    ]);
  });

  it('pluralizes several changes', async () => {
    await h.call('POST', '/proposal-1/change-requests', {
      baseRevision: 1,
      changes: [body.changes[0], { type: 'remove_package', areaSlug: 'kitchen' }],
    });
    expect(messages()[0]![1]).toContain('requested 2 changes');
    expect(messages()).toHaveLength(1);
  });

  it.each([
    [{ locked: true }, 403, 'This home is offered as-is; changes cannot be requested'],
    [
      { status: ProposalStatus.ChangesRequested },
      409,
      'You already have a change request waiting for the seller',
    ],
    [{ status: ProposalStatus.Signed }, 409, 'This proposal is closed'],
    [{ currentRevision: 2 }, 409, 'A newer revision is available; review it first'],
  ] as const)('refuses when the proposal is %o', async (state, status, error) => {
    current = proposalDoc(state);
    expect(await h.call('POST', '/proposal-1/change-requests', body)).toMatchObject({
      status,
      body: { error },
    });
    expect(repo.col('changeRequests').insertOne).not.toHaveBeenCalled();
  });

  it('loses cleanly to a concurrent seller revision (409)', async () => {
    proposals().findOneAndUpdate.mockResolvedValue(null);
    expect((await h.call('POST', '/proposal-1/change-requests', body)).status).toBe(409);
    expect(repo.col('changeRequests').insertOne).not.toHaveBeenCalled();
  });

  it('key holders can ask for changes too', async () => {
    scene.principal = keyHolder('proposal-1');
    expect((await h.call('POST', '/proposal-1/change-requests', body)).status).toBe(201);
  });
});

describe('POST /:id/change-requests/:crId/withdraw (buyer)', () => {
  beforeEach(() => {
    scene.principal = BUYER;
    current = proposalDoc({ status: ProposalStatus.ChangesRequested, openChangeRequestId: 'cr-1' });
  });

  it('withdraws the open request and hands the turn back', async () => {
    expect((await h.call('POST', '/proposal-1/change-requests/cr-1/withdraw')).body).toEqual({
      detail: 'proposal-1',
      status: ProposalStatus.Proposed,
    });
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1', status: ProposalStatus.ChangesRequested, openChangeRequestId: 'cr-1' },
      {
        $set: { status: ProposalStatus.Proposed, lastActivityAt: NOW_ISO, updatedAt: NOW_ISO },
        $unset: { openChangeRequestId: '' },
      },
    );
    expect(repo.col('changeRequests').updateOne).toHaveBeenCalledWith(
      { _id: 'cr-1', status: ChangeRequestStatus.Open },
      { $set: { status: ChangeRequestStatus.Withdrawn } },
    );
    expect(messages()).toEqual([[Party.System, 'Bea Buyer withdrew their change request.']]);
  });

  it('is a 409 when there is no such open request', async () => {
    proposals().findOneAndUpdate.mockResolvedValue(null);
    expect((await h.call('POST', '/proposal-1/change-requests/cr-9/withdraw')).body).toEqual({
      error: 'There is no open change request to withdraw',
    });
  });
});

describe('POST /:id/change-requests/:crId/decision (seller)', () => {
  const decide = (decisions: object[], extra = {}) =>
    h.call('POST', '/proposal-1/change-requests/cr-1/decision', { decisions, ...extra });

  beforeEach(() => {
    current = proposalDoc({ status: ProposalStatus.ChangesRequested, openChangeRequestId: 'cr-1' });
    repo.col('changeRequests').findOne.mockResolvedValue(changeRequestDoc());
  });

  it('approved changes form the next revision; declined ones are recorded with notes', async () => {
    vi.mocked(price).mockReturnValue(quote({ totalCents: 50_900_000 }));
    const res = await decide(
      [
        { changeId: 'ch-1', approved: true },
        { changeId: 'ch-2', approved: false, note: 'Out of stock' },
      ],
      { note: 'Done' },
    );
    expect(res.body).toEqual({ detail: 'proposal-1', status: ProposalStatus.Proposed });
    expect(repo.col('changeRequests').findOne).toHaveBeenCalledWith({
      _id: 'cr-1',
      proposalId: 'proposal-1',
    });
    const approved = [changeRequestDoc().changes[0]!.change];
    expect(applyChanges).toHaveBeenCalledWith(revisionDoc().selections, approved, contents);
    expect(price).toHaveBeenCalledWith(
      houseDoc(),
      pc,
      { ...revisionDoc().selections, applied: { itemIds: [] } },
      [],
      { tax: null, referral: null },
    );
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'proposal-1',
        status: ProposalStatus.ChangesRequested,
        openChangeRequestId: 'cr-1',
        currentRevision: 1,
      },
      {
        $set: {
          status: ProposalStatus.Proposed,
          currentRevision: 2,
          currentTotalCents: 50_900_000,
          lastActivityAt: NOW_ISO,
          updatedAt: NOW_ISO,
        },
        $unset: { openChangeRequestId: '' },
      },
    );
    expect(repo.col('revisions').insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ number: 2, changeRequestId: 'cr-1', note: 'Done' }),
    );
    const resolved = repo.col('changeRequests').updateOne.mock.calls[0]!;
    expect(resolved[0]).toEqual({ _id: 'cr-1' });
    expect(resolved[1].$set).toMatchObject({
      status: ChangeRequestStatus.Resolved,
      resolvedAt: NOW_ISO,
      resolvedByName: 'Sam Staff',
      resultRevision: 2,
    });
    expect(
      resolved[1].$set.changes.map((c: { decision: string; decisionNote?: string }) => [
        c.decision,
        c.decisionNote,
      ]),
    ).toEqual([
      [ChangeDecision.Approved, undefined],
      [ChangeDecision.Declined, 'Out of stock'],
    ]);
    expect(messages()).toEqual([
      [Party.System, 'Sam Staff approved 1 of 2 requested changes. Revision 2: $509,000.'],
      [Party.Seller, 'Done'],
    ]);
  });

  it('declining everything keeps the current revision, and its price', async () => {
    vi.mocked(price).mockReturnValue(quote({ totalCents: 50_100_000 }));
    await decide([
      { changeId: 'ch-1', approved: false },
      { changeId: 'ch-2', approved: false },
    ]);
    expect(proposals().findOneAndUpdate.mock.calls[0]![1].$set.currentRevision).toBe(1);
    expect(proposals().findOneAndUpdate.mock.calls[0]![1].$set.currentTotalCents).toBe(50_000_000);
    expect(repo.col('revisions').insertOne).not.toHaveBeenCalled();
    expect(messages()).toEqual([
      [Party.System, 'Sam Staff approved 0 of 2 requested changes. Revision 1 stands at $500,000.'],
    ]);
  });

  it('a new price adjustment alone also makes a new revision', async () => {
    await decide(
      [
        { changeId: 'ch-1', approved: false },
        { changeId: 'ch-2', approved: false },
      ],
      { adjustments: [{ label: 'Goodwill', amountCents: -500 }] },
    );
    expect(price).toHaveBeenCalledWith(
      houseDoc(),
      pc,
      expect.anything(),
      [{ label: 'Goodwill', amountCents: -500 }],
      { tax: null, referral: null },
    );
    expect(repo.col('revisions').insertOne).toHaveBeenCalled();
  });

  it("the answer keeps the revision's referral and province", async () => {
    const tax = {
      regionCode: 'ON',
      regionName: 'Ontario',
      lines: [{ label: 'HST', ratePercent: 13, amountCents: 6_500_000 }],
      totalCents: 6_500_000,
    };
    repo
      .col('revisions')
      .findOne.mockResolvedValue(revisionDoc({ quote: quote({ referral: REFERRAL, tax }) }));
    vi.mocked(carriedTaxRate).mockResolvedValue(ONTARIO);
    await decide([
      { changeId: 'ch-1', approved: true },
      { changeId: 'ch-2', approved: true },
    ]);
    expect(carriedTaxRate).toHaveBeenCalledWith(repo, tax);
    expect(price).toHaveBeenCalledWith(houseDoc(), pc, expect.anything(), [], {
      tax: ONTARIO,
      referral: REFERRAL,
    });
  });

  it('every requested change needs a decision (422)', async () => {
    expect(await decide([{ changeId: 'ch-1', approved: true }])).toMatchObject({
      status: 422,
      body: { error: 'Approve or decline every requested change' },
    });
    expect(
      (
        await decide([
          { changeId: 'ch-1', approved: true },
          { changeId: 'other', approved: true },
        ])
      ).status,
    ).toBe(422);
  });

  it('is a 404 for an unknown request and a 409 when already answered or raced', async () => {
    const all = [
      { changeId: 'ch-1', approved: true },
      { changeId: 'ch-2', approved: true },
    ];
    repo.col('changeRequests').findOne.mockResolvedValueOnce(null);
    expect((await decide(all)).status).toBe(404);
    repo
      .col('changeRequests')
      .findOne.mockResolvedValueOnce(changeRequestDoc({ status: ChangeRequestStatus.Resolved }));
    expect((await decide(all)).body).toEqual({ error: 'This change request was already answered' });
    current = proposalDoc({
      status: ProposalStatus.ChangesRequested,
      openChangeRequestId: 'cr-other',
    });
    expect((await decide(all)).status).toBe(409);
    current = proposalDoc({ status: ProposalStatus.ChangesRequested, openChangeRequestId: 'cr-1' });
    proposals().findOneAndUpdate.mockResolvedValue(null);
    expect((await decide(all)).status).toBe(409);
    expect(repo.col('revisions').insertOne).not.toHaveBeenCalled();
  });
});

describe('POST /:id/sign (buyer)', () => {
  const body = { revision: 1, fullName: 'Bea Buyer', agree: true };

  beforeEach(() => {
    scene.principal = BUYER;
  });

  it('signs the proposed revision, which is then final', async () => {
    expect((await h.call('POST', '/proposal-1/sign', body)).body).toEqual({
      detail: 'proposal-1',
      status: ProposalStatus.Signed,
    });
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1', status: ProposalStatus.Proposed, currentRevision: 1 },
      {
        $set: {
          status: ProposalStatus.Signed,
          signature: {
            fullName: 'Bea Buyer',
            revision: 1,
            totalCents: 50_000_000,
            signedAt: NOW_ISO,
          },
          lastActivityAt: NOW_ISO,
          updatedAt: NOW_ISO,
        },
      },
    );
    expect(repo.col('inventoryHomes').updateOne).not.toHaveBeenCalled();
    expect(messages()).toEqual([[Party.System, 'Bea Buyer signed revision 1 at $500,000.']]);
  });

  it('signing holds a pre-existing home; it is only sold when the agreement is executed', async () => {
    current = proposalDoc({ kind: 'inventory', inventoryHomeId: 'home-1' });
    await h.call('POST', '/proposal-1/sign', body);
    expect(repo.col('inventoryHomes').updateOne).toHaveBeenCalledWith(
      { _id: 'home-1', status: { $ne: InventoryStatus.Sold } },
      { $set: { status: InventoryStatus.Reserved, updatedAt: NOW_ISO } },
    );
  });

  it.each([
    [
      { status: ProposalStatus.ChangesRequested },
      'Withdraw your change request or wait for the seller first',
    ],
    [{ status: ProposalStatus.Withdrawn }, 'This proposal is closed'],
    [{ currentRevision: 2 }, 'A newer revision is available; review it before signing'],
  ] as const)('refuses when the proposal is %o', async (state, error) => {
    current = proposalDoc(state);
    expect(await h.call('POST', '/proposal-1/sign', body)).toMatchObject({
      status: 409,
      body: { error },
    });
    expect(proposals().findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('requires agreement (400) and loses cleanly to a concurrent change (409)', async () => {
    expect((await h.call('POST', '/proposal-1/sign', { ...body, agree: false })).status).toBe(400);
    proposals().findOneAndUpdate.mockResolvedValue(null);
    expect((await h.call('POST', '/proposal-1/sign', body)).body).toEqual({
      error: 'The proposal changed meanwhile; review it before signing',
    });
  });
});

describe('POST /:id/decline (buyer)', () => {
  beforeEach(() => {
    scene.principal = BUYER;
  });

  it('declines an active proposal and withdraws open requests', async () => {
    expect((await h.call('POST', '/proposal-1/decline')).body).toEqual({
      detail: 'proposal-1',
      status: ProposalStatus.Declined,
    });
    expect(proposals().findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'proposal-1',
        status: { $in: [ProposalStatus.Proposed, ProposalStatus.ChangesRequested] },
      },
      {
        $set: { status: ProposalStatus.Declined, lastActivityAt: NOW_ISO, updatedAt: NOW_ISO },
        $unset: { openChangeRequestId: '' },
      },
    );
    expect(repo.col('changeRequests').updateMany).toHaveBeenCalledWith(
      { proposalId: 'proposal-1', status: ChangeRequestStatus.Open },
      { $set: { status: ChangeRequestStatus.Withdrawn } },
    );
    expect(messages()).toEqual([[Party.System, 'Bea Buyer declined this proposal.']]);
  });

  it('a closed proposal is a 409', async () => {
    proposals().findOneAndUpdate.mockResolvedValue(null);
    expect((await h.call('POST', '/proposal-1/decline')).status).toBe(409);
  });
});
