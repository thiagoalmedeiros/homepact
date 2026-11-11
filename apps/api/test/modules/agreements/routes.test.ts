import { AgreementStatus, InventoryStatus, ProposalStatus, SignerStatus } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findCompany } from '../../../src/data/platform-repo.js';
import { composeAgreement } from '../../../src/modules/agreements/document.js';
import { renderAgreementPdf } from '../../../src/modules/agreements/pdf.js';
import { agreementRoutes } from '../../../src/modules/agreements/routes.js';
import { toAgreement, type AgreementDoc } from '../../../src/modules/agreements/store.js';
import { addMessage, loadProposalFor } from '../../../src/modules/proposals/store.js';
import {
  HASH,
  SIGNATURE,
  TERMS,
  agreementDoc,
  houseDoc,
  inventoryDoc,
  proposalDoc,
  purchaserDoc,
  quote,
  revisionDoc,
  signature,
  signedPurchaser,
  templateDoc,
} from '../../support/fixtures.js';
import {
  ADMIN,
  BUYER,
  COMPANY_ID,
  COMPANY_TENANT,
  NOW,
  NOW_ISO,
  PLATFORM_TENANT,
  STAFF,
  agreementSigner,
  keyHolder,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockContext,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({
  newId: vi.fn(),
  reference: vi.fn(() => 'A-TEST-0001'),
  sha256: vi.fn(() => 'pdf-sha'),
}));
vi.mock('../../../src/data/platform-repo.js', () => ({ findCompany: vi.fn() }));
vi.mock('../../../src/modules/agreements/document.js', () => ({ composeAgreement: vi.fn() }));
vi.mock('../../../src/modules/agreements/pdf.js', () => ({ renderAgreementPdf: vi.fn() }));
vi.mock('../../../src/modules/proposals/store.js', () => ({
  addMessage: vi.fn(),
  loadProposalFor: vi.fn(),
}));
vi.mock('../../../src/modules/access-keys/keys.js', () => ({ assertKeyActive: vi.fn() }));
const ids = await import('../../../src/data/ids.js');

const COMPANY = { _id: COMPANY_ID, name: 'Company A', contact: { phone: '555-0100' } };
const PDF = Buffer.from('%PDF-1.3 rendered');
const STORED = Buffer.from('%PDF-1.3 stored when executed');
const NEW_HASH = 'beef'.padEnd(64, '1');
const PURCHASERS = [{ name: 'Bea Buyer', email: 'bea@buyer.test' }];

const {
  _id: _i,
  companyId: _c,
  status: _s,
  purchasers: _p,
  createdByName: _b,
  createdAt: _ca,
  updatedAt: _u,
  ...CONTENT
} = agreementDoc();
const composed = (over: object = {}) => ({
  ...CONTENT,
  purchasers: [{ id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' }],
  ...over,
});

let h: Harness;
let repo: MockRepo;
let scene: Scene;
let ctx: MockContext;
const col = {
  agreements: () => repo.col('agreements'),
  proposals: () => repo.col('proposals'),
  templates: () => repo.col('agreementTemplates'),
  revisions: () => repo.col('revisions'),
  houses: () => repo.col('houses'),
  homes: () => repo.col('inventoryHomes'),
  files: () => repo.col('agreementFiles'),
};
const signedProposal = (over = {}) =>
  proposalDoc({ status: ProposalStatus.Signed, signature: SIGNATURE, ...over });
let stored: AgreementDoc | null;
/** An agreement that was sent out for signature. */
const sent = (over: Partial<AgreementDoc> = {}) =>
  agreementDoc({
    status: AgreementStatus.UnderReview,
    issuedAt: NOW_ISO,
    issuedByName: 'Sam Staff',
    purchasers: [purchaserDoc({ invitedAt: NOW_ISO })],
    ...over,
  });

beforeEach(async () => {
  repo = mockRepo();
  ctx = mockContext();
  scene = { tenant: COMPANY_TENANT, repo, principal: STAFF };
  let n = 0;
  vi.mocked(ids.newId).mockImplementation(() => `id-${++n}`);
  vi.mocked(findCompany).mockResolvedValue(COMPANY as never);
  vi.mocked(composeAgreement).mockReturnValue(composed());
  vi.mocked(renderAgreementPdf).mockResolvedValue(PDF);
  vi.mocked(loadProposalFor).mockResolvedValue(signedProposal());
  stored = agreementDoc();
  col.agreements().findOne.mockImplementation(async () => stored);
  col
    .agreements()
    .findOneAndUpdate.mockImplementation(
      async (_f, u: { $set: object }) => stored && { ...stored, ...u.$set },
    );
  col.proposals().findOne.mockResolvedValue(signedProposal());
  col.proposals().findOneAndUpdate.mockImplementation(async (_f, u: { $set: object }) => ({
    ...signedProposal(),
    ...u.$set,
  }));
  col.templates().findOne.mockResolvedValue(templateDoc());
  col.revisions().findOne.mockResolvedValue(revisionDoc());
  col.houses().findOne.mockResolvedValue(houseDoc());
  col.homes().findOne.mockResolvedValue(inventoryDoc());
  h = await serveRouter(agreementRoutes(ctx), scene);
});
afterEach(() => h.close());

const messages = () => vi.mocked(addMessage).mock.calls.map((c) => [c[1], c[4]]);
const written = () =>
  col.agreements().findOneAndUpdate.mock.calls.at(-1)?.[1] as { $set: Record<string, unknown> };

describe('access', () => {
  it('every endpoint requires a signed-in user', async () => {
    delete scene.principal;
    for (const [method, path] of [
      ['GET', '/'],
      ['POST', '/'],
      ['GET', '/agr-1'],
      ['GET', '/agr-1/pdf'],
      ['POST', '/agr-1/sign'],
      ['POST', '/agr-1/countersign'],
    ] as const) {
      expect((await h.call(method, path, {})).status, path).toBe(401);
    }
  });

  it('preparing, sending and cancelling are for staff; signing is for purchasers', async () => {
    scene.principal = BUYER;
    for (const [method, path] of [
      ['GET', '/'],
      ['POST', '/'],
      ['PUT', '/agr-1'],
      ['POST', '/agr-1/issue'],
      ['POST', '/agr-1/purchasers/pur-1/invite'],
      ['POST', '/agr-1/cancel'],
    ] as const) {
      expect((await h.call(method, path, {})).status, path).toBe(403);
    }
    scene.principal = ADMIN;
    expect((await h.call('POST', '/agr-1/sign', {})).status).toBe(403);
    expect(col.agreements().findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('only an administrator of the company may countersign', async () => {
    scene.principal = STAFF;
    expect((await h.call('POST', '/agr-1/countersign', {})).status).toBe(403);
    scene.principal = BUYER;
    expect((await h.call('POST', '/agr-1/countersign', {})).status).toBe(403);
  });
});

describe('GET /', () => {
  it('lists the company’s agreements, newest activity first, optionally filtered', async () => {
    col.agreements().find.mockResolvedValue([agreementDoc()]);
    const res = await h.call('GET', '/?status=draft&proposalId=proposal-1');
    expect(res.body).toEqual([
      expect.objectContaining({ id: 'agr-1', buyerName: 'Bea Buyer', signedCount: 0 }),
    ]);
    expect(col.agreements().find).toHaveBeenCalledWith(
      { status: AgreementStatus.Draft, proposalId: 'proposal-1' },
      { sort: { updatedAt: -1 }, limit: 300 },
    );
    expect((await h.call('GET', '/?status=bogus')).status).toBe(400);
  });
});

describe('POST / (prepare from a signed proposal)', () => {
  const body = {
    proposalId: 'proposal-1',
    templateId: 'tpl-1',
    purchasers: PURCHASERS,
    deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
    conditions: [{ label: 'Financing' }],
    closingDate: '2027-03-15',
  };

  it('fills the company template with the signed revision and claims the proposal', async () => {
    const res = await h.call('POST', '/', body);
    expect(res.status).toBe(201);
    expect(col.proposals().findOne).toHaveBeenCalledWith({ _id: 'proposal-1' });
    expect(col.templates().findOne).toHaveBeenCalledWith({ _id: 'tpl-1' });
    expect(col.revisions().findOne).toHaveBeenCalledWith({
      proposalId: 'proposal-1',
      number: SIGNATURE.revision,
    });
    expect(findCompany).toHaveBeenCalledWith(ctx.db, COMPANY_ID);
    expect(composeAgreement).toHaveBeenCalledWith({
      reference: 'A-TEST-0001',
      preparedAt: NOW,
      company: COMPANY,
      proposal: signedProposal(),
      revision: revisionDoc(),
      house: houseDoc(),
      template: templateDoc(),
      purchasers: [{ id: 'id-1', name: 'Bea Buyer', email: 'bea@buyer.test' }],
      terms: body,
    });
    expect(col.proposals().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proposal-1', status: ProposalStatus.Signed, agreementId: { $exists: false } },
      { $set: { agreementId: 'id-2' } },
    );
    const doc = {
      _id: 'id-2',
      ...composed(),
      purchasers: [
        { id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test', status: SignerStatus.Pending },
      ],
      status: AgreementStatus.Draft,
      createdByName: 'Sam Staff',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };
    expect(col.agreements().insertOne).toHaveBeenCalledWith(doc);
    expect(res.body).toEqual(toAgreement({ ...doc, companyId: COMPANY_ID } as AgreementDoc));
    expect(addMessage).not.toHaveBeenCalled(); // drafts are the seller's business
  });

  it('copies the price of the signed revision to the cent, never a typed one', async () => {
    const revision = revisionDoc({ quote: quote({ totalCents: 50_123_456 }) });
    col.revisions().findOne.mockResolvedValue(revision);
    vi.mocked(composeAgreement).mockImplementation((src) => ({
      ...composed(),
      quote: src.revision.quote,
      terms: {
        ...TERMS,
        depositCents: src.terms.deposits.reduce((t, d) => t + d.amountCents, 0),
      },
    }));
    const res = await h.call('POST', '/', {
      ...body,
      deposits: [
        { label: 'on signing', amountCents: 1_000_000 },
        { label: 'on closing', amountCents: 500_001 },
      ],
    });
    expect(res.body.quote.totalCents).toBe(50_123_456);
    expect(res.body.quote.totalCents).toBe(revision.quote.totalCents);
    expect(res.body.terms.depositCents).toBe(1_500_001);
  });

  it('takes a pre-existing home off the market while the agreement runs', async () => {
    col.proposals().findOne.mockResolvedValue(signedProposal({ inventoryHomeId: 'home-1' }));
    col
      .proposals()
      .findOneAndUpdate.mockResolvedValue(signedProposal({ inventoryHomeId: 'home-1' }));
    expect((await h.call('POST', '/', body)).status).toBe(201);
    expect(col.homes().updateOne).toHaveBeenCalledWith(
      { _id: 'home-1' },
      { $set: { status: InventoryStatus.Reserved, updatedAt: NOW_ISO } },
    );

    col.homes().findOne.mockResolvedValue(inventoryDoc({ status: InventoryStatus.Sold }));
    expect(await h.call('POST', '/', body)).toMatchObject({
      status: 409,
      body: { error: 'This home is already sold' },
    });
  });

  it('another company’s proposal or template is simply not found here', async () => {
    col.proposals().findOne.mockResolvedValueOnce(null);
    expect(await h.call('POST', '/', body)).toMatchObject({
      status: 404,
      body: { error: 'Proposal not found' },
    });
    col.templates().findOne.mockResolvedValueOnce(null);
    expect(await h.call('POST', '/', body)).toMatchObject({
      status: 422,
      body: { error: 'Choose one of your agreement templates' },
    });
    expect(col.proposals().findOneAndUpdate).not.toHaveBeenCalled();
    expect(col.agreements().insertOne).not.toHaveBeenCalled();
  });

  it('only signed proposals, one live agreement each', async () => {
    col.proposals().findOne.mockResolvedValueOnce(proposalDoc({ status: ProposalStatus.Proposed }));
    expect((await h.call('POST', '/', body)).status).toBe(409);
    col.proposals().findOne.mockResolvedValueOnce(signedProposal({ agreementId: 'agr-0' }));
    expect(await h.call('POST', '/', body)).toMatchObject({
      status: 409,
      body: { error: 'This proposal already has a purchase agreement' },
    });
    col.proposals().findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await h.call('POST', '/', body)).status).toBe(409);
    expect(col.agreements().insertOne).not.toHaveBeenCalled();
  });

  it('the deposit schedule cannot exceed the price', async () => {
    col.revisions().findOne.mockResolvedValue(revisionDoc({ quote: quote({ totalCents: 100 }) }));
    expect(
      await h.call('POST', '/', {
        ...body,
        deposits: [
          { label: 'on signing', amountCents: 60 },
          { label: 'on closing', amountCents: 41 },
        ],
      }),
    ).toMatchObject({
      status: 422,
      body: { error: 'The deposit cannot be more than the purchase price' },
    });
    col.revisions().findOne.mockResolvedValue(null);
    expect((await h.call('POST', '/', body)).status).toBe(404);
  });

  it('releases the proposal if the agreement cannot be written', async () => {
    col.agreements().insertOne.mockRejectedValue(new Error('db down'));
    expect((await h.call('POST', '/', body)).status).toBe(500);
    expect(col.proposals().updateOne).toHaveBeenCalledWith(
      { _id: 'proposal-1', agreementId: 'id-2' },
      { $unset: { agreementId: '' } },
    );
  });

  it('validates the terms, and is not available on the platform origin', async () => {
    expect((await h.call('POST', '/', { ...body, closingDate: '2027-02-30' })).status).toBe(400);
    expect((await h.call('POST', '/', { ...body, deposits: [] })).status).toBe(400);
    expect((await h.call('POST', '/', { ...body, purchasers: [] })).status).toBe(400);
    scene.tenant = PLATFORM_TENANT;
    expect((await h.call('POST', '/', body)).status).toBe(403);
  });
});

describe('GET /:id', () => {
  it('staff read any agreement of their company, drafts included', async () => {
    expect((await h.call('GET', '/agr-1')).body).toEqual(toAgreement(agreementDoc()));
    expect(col.agreements().findOne).toHaveBeenCalledWith({ _id: 'agr-1' });
    stored = null;
    expect((await h.call('GET', '/agr-1')).status).toBe(404);
  });

  it('buyers never see a draft, and see a sent one only if they can open its proposal', async () => {
    scene.principal = keyHolder('proposal-1');
    expect((await h.call('GET', '/agr-1')).status).toBe(404);
    expect(loadProposalFor).not.toHaveBeenCalled();

    stored = sent();
    expect((await h.call('GET', '/agr-1')).status).toBe(200);
    expect(loadProposalFor).toHaveBeenCalledWith(expect.anything(), 'proposal-1');

    vi.mocked(loadProposalFor).mockRejectedValue(
      Object.assign(new Error('Not found'), { status: 404, expose: true }),
    );
    expect((await h.call('GET', '/agr-1')).status).toBe(404);
  });

  it('a purchaser on their signing link reads it, and learns which signer they are', async () => {
    stored = sent();
    scene.principal = agreementSigner('agr-1', 'pur-1');
    expect((await h.call('GET', '/agr-1')).body).toMatchObject({ viewerPurchaserId: 'pur-1' });
    expect(loadProposalFor).not.toHaveBeenCalled();

    scene.principal = agreementSigner('agr-other', 'pur-1');
    expect((await h.call('GET', '/agr-1')).body.viewerPurchaserId).toBeUndefined();
  });
});

describe('PUT /:id (re-prepare)', () => {
  const body = {
    templateId: 'tpl-2',
    purchasers: PURCHASERS,
    deposits: [{ label: 'on signing', amountCents: 1_000_000 }],
    conditions: [],
  };

  it('re-fills the latest template with the new terms, keeping the number', async () => {
    vi.mocked(composeAgreement).mockReturnValue(composed({ contentHash: NEW_HASH }));
    const res = await h.call('PUT', '/agr-1', body);
    expect(res).toMatchObject({ status: 200, body: { contentHash: NEW_HASH } });
    expect(col.templates().findOne).toHaveBeenCalledWith({ _id: 'tpl-2' });
    expect(composeAgreement).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'A-TEST-0001', terms: body }),
    );
    expect(col.agreements().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'agr-1', status: AgreementStatus.Draft, updatedAt: NOW_ISO },
      {
        $set: {
          ...composed({ contentHash: NEW_HASH }),
          purchasers: [purchaserDoc()],
          updatedAt: NOW_ISO,
        },
      },
    );
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('changing a clause after someone signed invalidates their signature', async () => {
    stored = sent({
      status: AgreementStatus.Signed,
      signedAt: NOW_ISO,
      purchasers: [signedPurchaser({ id: 'pur-1' }), purchaserDoc({ id: 'pur-2', name: 'Ben' })],
    });
    vi.mocked(composeAgreement).mockReturnValue(
      composed({
        contentHash: NEW_HASH,
        purchasers: [
          { id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' },
          { id: 'pur-2', name: 'Ben' },
        ],
      }),
    );
    const res = await h.call('PUT', '/agr-1', {
      ...body,
      purchasers: [...PURCHASERS, { name: 'Ben' }],
    });
    expect(res.status).toBe(200);
    expect(written().$set).toMatchObject({
      status: AgreementStatus.UnderReview,
      purchasers: [
        expect.objectContaining({
          id: 'pur-1',
          status: SignerStatus.Invalidated,
          invalidatedAt: NOW_ISO,
          signature: signature(),
        }),
        expect.objectContaining({ id: 'pur-2', status: SignerStatus.Pending }),
      ],
    });
    expect(col.agreements().findOneAndUpdate.mock.calls.at(-1)?.[1]).toMatchObject({
      $unset: { signedAt: '' },
    });
    expect(messages()).toEqual([
      [
        'proposal-1',
        'Sam Staff changed purchase agreement A-TEST-0001; 1 signature is no longer valid and must be given again.',
      ],
    ]);
  });

  it('the same text after a change of mind leaves the signatures alone', async () => {
    stored = sent({ purchasers: [signedPurchaser()] });
    vi.mocked(composeAgreement).mockReturnValue(composed()); // same contentHash
    expect((await h.call('PUT', '/agr-1', body)).status).toBe(200);
    expect(written().$set['purchasers']).toEqual([signedPurchaser()]);
    expect(written().$set['status']).toBeUndefined();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('executed and cancelled agreements are fixed', async () => {
    stored = sent({ status: AgreementStatus.Executed, executedAt: NOW_ISO });
    expect(await h.call('PUT', '/agr-1', body)).toMatchObject({
      status: 409,
      body: { error: 'An executed or cancelled agreement can no longer be changed' },
    });
    stored = agreementDoc({ status: AgreementStatus.Cancelled });
    expect((await h.call('PUT', '/agr-1', body)).status).toBe(409);
    stored = agreementDoc();
    col.agreements().findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await h.call('PUT', '/agr-1', body)).status).toBe(409);
    col.proposals().findOne.mockResolvedValueOnce(null);
    expect((await h.call('PUT', '/agr-1', body)).status).toBe(404);
  });
});

describe('POST /:id/issue (send it out for signature)', () => {
  it('invites every purchaser and hands the seller their links and codes', async () => {
    const res = await h.call('POST', '/agr-1/issue', { contentHash: HASH });
    expect(res).toMatchObject({
      status: 200,
      body: {
        agreement: { status: AgreementStatus.UnderReview, issuedAt: NOW_ISO },
        invitations: [
          { purchaserId: 'pur-1', name: 'Bea Buyer', key: 'key-pur-1', code: 'AAAA-BBBB' },
        ],
      },
    });
    expect(res.body.agreement.issuedByName).toBe('Sam Staff');
    expect(col.agreements().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'agr-1', status: AgreementStatus.Draft, contentHash: HASH },
      expect.anything(),
    );
    expect(written().$set['purchasers']).toEqual([purchaserDoc({ invitedAt: NOW_ISO })]);
    expect(ctx.signatures.invite).toHaveBeenCalledWith(
      { repo, now: NOW, actorId: 'staff-1' },
      {
        agreementId: 'agr-1',
        reference: 'A-TEST-0001',
        title: agreementDoc().title,
        contentHash: HASH,
      },
      [{ id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' }],
    );
    expect(messages()).toEqual([
      ['proposal-1', 'Sam Staff sent purchase agreement A-TEST-0001 for signature.'],
    ]);
  });

  it('refuses stale content, a second send, and a lost race', async () => {
    expect(await h.call('POST', '/agr-1/issue', { contentHash: NEW_HASH })).toMatchObject({
      status: 409,
      body: { error: 'The agreement changed; review it again before sending' },
    });
    col.agreements().findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await h.call('POST', '/agr-1/issue', { contentHash: HASH })).status).toBe(409);
    stored = sent();
    expect((await h.call('POST', '/agr-1/issue', { contentHash: HASH })).status).toBe(409);
    expect((await h.call('POST', '/agr-1/issue', { contentHash: 'nope' })).status).toBe(400);
    expect(ctx.signatures.invite).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('one purchaser can be invited again, e.g. when the first link never arrived', async () => {
    stored = sent();
    const res = await h.call('POST', '/agr-1/purchasers/pur-1/invite', {});
    expect(res).toMatchObject({ status: 201, body: { purchaserId: 'pur-1', code: 'AAAA-BBBB' } });
    expect((await h.call('POST', '/agr-1/purchasers/nope/invite', {})).status).toBe(404);

    stored = sent({ status: AgreementStatus.Executed, executedAt: NOW_ISO });
    expect((await h.call('POST', '/agr-1/purchasers/pur-1/invite', {})).status).toBe(201);

    stored = agreementDoc(); // never sent
    expect(await h.call('POST', '/agr-1/purchasers/pur-1/invite', {})).toMatchObject({
      status: 409,
      body: { error: 'Send the agreement for signature first' },
    });
    stored = sent({ status: AgreementStatus.Cancelled, cancelledAt: NOW_ISO });
    expect((await h.call('POST', '/agr-1/purchasers/pur-1/invite', {})).status).toBe(409);
  });
});

describe('POST /:id/sign (a purchaser signs)', () => {
  const body = { contentHash: HASH, fullName: 'Bea Q. Buyer', initials: [2], agree: true };
  beforeEach(() => {
    stored = sent({
      purchasers: [
        purchaserDoc({ id: 'pur-1', invitedAt: NOW_ISO }),
        purchaserDoc({ id: 'pur-2', name: 'Ben Buyer', invitedAt: NOW_ISO }),
      ],
    });
    scene.principal = agreementSigner('agr-1', 'pur-1');
  });

  it('records the signature of that purchaser only, with the evidence of the provider', async () => {
    const res = await h.call('POST', '/agr-1/sign', body);
    expect(ctx.signatures.capture).toHaveBeenCalledWith(
      { repo, now: NOW, actorId: 'key-sign-1' },
      expect.objectContaining({ agreementId: 'agr-1', contentHash: HASH }),
      { id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' },
      { fullName: 'Bea Q. Buyer', initials: [2], contentHash: HASH, ip: expect.any(String) },
    );
    expect(col.agreements().findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'agr-1',
        status: AgreementStatus.UnderReview,
        contentHash: HASH,
        updatedAt: NOW_ISO,
      },
      expect.anything(),
    );
    const purchasers = written().$set['purchasers'] as { id: string; status: SignerStatus }[];
    expect(purchasers[0]).toMatchObject({
      id: 'pur-1',
      status: SignerStatus.Signed,
      signature: expect.objectContaining({
        fullName: 'Bea Q. Buyer',
        provider: 'test-provider',
        contentHash: HASH,
        initials: [2],
      }),
    });
    expect(purchasers[1]).toMatchObject({ id: 'pur-2', status: SignerStatus.Pending });
    expect(written().$set['status']).toBeUndefined();
    expect(res.body).toMatchObject({ viewerPurchaserId: 'pur-1' });
    expect(messages()).toEqual([
      ['proposal-1', 'Bea Q. Buyer signed purchase agreement A-TEST-0001 (1 of 2 purchasers).'],
    ]);
  });

  it('the last signature makes the agreement ready for the countersignature', async () => {
    stored = sent({
      purchasers: [
        signedPurchaser({ id: 'pur-1' }),
        purchaserDoc({ id: 'pur-2', name: 'Ben Buyer' }),
      ],
    });
    scene.principal = agreementSigner('agr-1', 'pur-2');
    const res = await h.call('POST', '/agr-1/sign', { ...body, fullName: 'Ben Buyer' });
    expect(res.body).toMatchObject({ status: AgreementStatus.Signed, signedAt: NOW_ISO });
    expect(messages()).toEqual([
      ['proposal-1', 'Ben Buyer signed purchase agreement A-TEST-0001 (2 of 2 purchasers).'],
      [
        'proposal-1',
        'Every purchaser has signed purchase agreement A-TEST-0001; it is waiting to be countersigned.',
      ],
    ]);
  });

  it('every key clause has to be initialled first', async () => {
    expect(await h.call('POST', '/agr-1/sign', { ...body, initials: [] })).toMatchObject({
      status: 422,
      body: { error: 'Initial every key clause before signing' },
    });
    expect(col.agreements().findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('only the purchaser whose link it is, once, on what they reviewed', async () => {
    scene.principal = keyHolder('proposal-1');
    expect(await h.call('POST', '/agr-1/sign', body)).toMatchObject({
      status: 403,
      body: { error: 'Open your own signing link to sign this agreement' },
    });
    scene.principal = agreementSigner('agr-1', 'someone-else');
    expect((await h.call('POST', '/agr-1/sign', body)).status).toBe(403);

    scene.principal = agreementSigner('agr-1', 'pur-1');
    expect(await h.call('POST', '/agr-1/sign', { ...body, contentHash: NEW_HASH })).toMatchObject({
      status: 409,
      body: { error: 'The agreement changed; review it again before signing' },
    });
    stored = sent({ purchasers: [signedPurchaser({ id: 'pur-1' })] });
    expect(await h.call('POST', '/agr-1/sign', body)).toMatchObject({
      status: 409,
      body: { error: 'You already signed this agreement' },
    });
    stored = sent({ status: AgreementStatus.Executed });
    expect((await h.call('POST', '/agr-1/sign', body)).status).toBe(409);
    stored = agreementDoc({ status: AgreementStatus.Cancelled, issuedAt: NOW_ISO });
    expect((await h.call('POST', '/agr-1/sign', body)).status).toBe(409);
    expect((await h.call('POST', '/agr-1/sign', { ...body, agree: false })).status).toBe(400);
    expect(col.agreements().findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('two purchasers signing at the same moment: the second one retries', async () => {
    col.agreements().findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await h.call('POST', '/agr-1/sign', body)).toMatchObject({
      status: 409,
      body: { error: 'The agreement changed meanwhile; review it again before signing' },
    });
    expect(addMessage).not.toHaveBeenCalled();
  });
});

describe('POST /:id/countersign (the builder closes it)', () => {
  const body = { contentHash: HASH, fullName: 'Alex Admin', agree: true };
  beforeEach(() => {
    scene.principal = ADMIN;
    stored = sent({
      status: AgreementStatus.Signed,
      signedAt: NOW_ISO,
      purchasers: [signedPurchaser()],
    });
  });

  it('executes the agreement, stores the PDF and sells a pre-existing home', async () => {
    col.proposals().findOne.mockResolvedValue(signedProposal({ inventoryHomeId: 'home-1' }));
    const res = await h.call('POST', '/agr-1/countersign', body);
    expect(res.body).toMatchObject({
      status: AgreementStatus.Executed,
      executedAt: NOW_ISO,
      counterSignature: expect.objectContaining({ fullName: 'Alex Admin', contentHash: HASH }),
      executedPdf: { sha256: 'pdf-sha', size: PDF.length },
    });
    expect(res.body.executedPdf).not.toHaveProperty('fileId');
    expect(renderAgreementPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgreementStatus.Executed,
        executedAt: NOW_ISO,
        counterSignature: expect.objectContaining({ fullName: 'Alex Admin' }),
      }),
    );
    expect(col.files().insertOne).toHaveBeenCalledWith({
      _id: 'id-1',
      agreementId: 'agr-1',
      kind: 'executed',
      contentType: 'application/pdf',
      data: PDF,
      sha256: 'pdf-sha',
      size: PDF.length,
      createdAt: NOW_ISO,
    });
    expect(col.homes().updateOne).toHaveBeenCalledWith(
      { _id: 'home-1' },
      { $set: { status: InventoryStatus.Sold, updatedAt: NOW_ISO } },
    );
    expect(ctx.signatures.revoke).toHaveBeenCalledWith(
      { repo, now: NOW, actorId: 'admin-1' },
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
    expect(messages()).toEqual([
      [
        'proposal-1',
        'Alex Admin countersigned purchase agreement A-TEST-0001. It is now executed.',
      ],
    ]);
  });

  it('countersigning before every purchaser has signed is a conflict', async () => {
    stored = sent({
      purchasers: [signedPurchaser({ id: 'pur-1' }), purchaserDoc({ id: 'pur-2' })],
    });
    expect(await h.call('POST', '/agr-1/countersign', body)).toMatchObject({
      status: 409,
      body: { error: 'Every purchaser must sign before you can countersign' },
    });
    stored = agreementDoc(); // still a draft
    expect((await h.call('POST', '/agr-1/countersign', body)).status).toBe(409);
    stored = sent({ status: AgreementStatus.Executed, executedAt: NOW_ISO });
    expect(await h.call('POST', '/agr-1/countersign', body)).toMatchObject({
      status: 409,
      body: { error: 'This agreement is already executed' },
    });
    expect(col.files().insertOne).not.toHaveBeenCalled();
  });

  it('refuses stale content and drops the PDF if the agreement moved meanwhile', async () => {
    expect(
      (await h.call('POST', '/agr-1/countersign', { ...body, contentHash: NEW_HASH })).status,
    ).toBe(409);
    col.agreements().findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await h.call('POST', '/agr-1/countersign', body)).status).toBe(409);
    expect(col.files().deleteOne).toHaveBeenCalledWith({ _id: 'id-1' });
    expect(addMessage).not.toHaveBeenCalled();
  });
});

describe('POST /:id/cancel', () => {
  it('voids a draft quietly and frees the proposal for a new agreement', async () => {
    const res = await h.call('POST', '/agr-1/cancel', {});
    expect(res).toMatchObject({
      status: 200,
      body: {
        status: AgreementStatus.Cancelled,
        cancelledAt: NOW_ISO,
        cancelledByName: 'Sam Staff',
      },
    });
    expect(col.agreements().findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'agr-1',
        status: {
          $in: [AgreementStatus.Draft, AgreementStatus.UnderReview, AgreementStatus.Signed],
        },
      },
      expect.anything(),
    );
    expect(col.proposals().updateOne).toHaveBeenCalledWith(
      { _id: 'proposal-1', agreementId: 'agr-1' },
      { $unset: { agreementId: '' } },
    );
    expect(ctx.signatures.revoke).toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('tells the buyer when a sent agreement is withdrawn, and voids its signatures', async () => {
    stored = sent({ purchasers: [signedPurchaser()] });
    const res = await h.call('POST', '/agr-1/cancel', { reason: 'Wrong closing date.' });
    expect(res.body).toMatchObject({ cancelReason: 'Wrong closing date.' });
    expect(written().$set['purchasers']).toEqual([
      expect.objectContaining({ status: SignerStatus.Invalidated }),
    ]);
    expect(messages()).toEqual([
      ['proposal-1', 'Sam Staff cancelled purchase agreement A-TEST-0001. Wrong closing date.'],
    ]);
  });

  it('executed or already cancelled agreements stay as they are', async () => {
    stored = sent({ status: AgreementStatus.Executed, executedAt: NOW_ISO });
    expect(await h.call('POST', '/agr-1/cancel', {})).toMatchObject({
      status: 409,
      body: { error: 'An executed agreement cannot be cancelled' },
    });
    stored = agreementDoc({ status: AgreementStatus.Cancelled });
    expect((await h.call('POST', '/agr-1/cancel', {})).status).toBe(409);
    stored = agreementDoc();
    col.agreements().findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await h.call('POST', '/agr-1/cancel', {})).status).toBe(409);
    expect(col.proposals().updateOne).not.toHaveBeenCalled();
  });
});

describe('GET /:id/pdf', () => {
  it('renders a draft on the fly, as a private download', async () => {
    const res = await h.call('GET', '/agr-1/pdf');
    expect(res.status).toBe(200);
    expect(res.body).toBe(PDF.toString());
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="A-TEST-0001-draft.pdf"',
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(renderAgreementPdf).toHaveBeenCalledWith(toAgreement(agreementDoc()));
  });

  it('serves the executed PDF exactly as stored', async () => {
    stored = sent({
      status: AgreementStatus.Executed,
      executedAt: NOW_ISO,
      executedPdf: { fileId: 'file-1', sha256: 'pdf-sha', size: STORED.length },
    });
    col.files().findOne.mockResolvedValue({ data: { buffer: new Uint8Array(STORED) } });
    scene.principal = BUYER;
    const res = await h.call('GET', '/agr-1/pdf');
    expect(res.body).toBe(STORED.toString());
    expect(res.headers.get('content-disposition')).toContain('A-TEST-0001-executed.pdf');
    expect(col.files().findOne).toHaveBeenCalledWith({ _id: 'file-1', agreementId: 'agr-1' });
    expect(renderAgreementPdf).not.toHaveBeenCalled();

    col.files().findOne.mockResolvedValue(null);
    expect((await h.call('GET', '/agr-1/pdf')).body).toBe(PDF.toString());
  });

  it('follows the same access rules as the agreement', async () => {
    scene.principal = BUYER;
    expect((await h.call('GET', '/agr-1/pdf')).status).toBe(404);
    expect(renderAgreementPdf).not.toHaveBeenCalled();
  });
});
