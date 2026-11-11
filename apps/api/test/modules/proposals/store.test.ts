import { AgreementStatus, Party, ProposalStatus, Role } from '@homepact/shared';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../src/auth/tokens.js';
import { assertKeyActive } from '../../../src/modules/access-keys/keys.js';
import {
  addMessage,
  authorName,
  describeChange,
  loadDetail,
  loadProposalFor,
  packageContents,
  partyOf,
  toChangeRequest,
  toMessage,
  toProposal,
  toRevision,
} from '../../../src/modules/proposals/store.js';
import {
  agreementDoc,
  catalog,
  changeRequestDoc,
  messageDoc,
  proposalDoc,
  revisionDoc,
} from '../../support/fixtures.js';
import {
  ADMIN,
  BUYER,
  NOW,
  NOW_ISO,
  STAFF,
  keyHolder,
  mockRepo,
  type MockRepo,
} from '../../support/mocks.js';

vi.mock('../../../src/modules/access-keys/keys.js', () => ({ assertKeyActive: vi.fn() }));
vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'new-id') }));

let repo: MockRepo;
const request = (principal?: Principal) => ({ repo, principal }) as unknown as Request;

beforeEach(() => {
  repo = mockRepo();
});

describe('mappers', () => {
  it('expose _id as id and never the company', () => {
    for (const [map, doc] of [
      [toProposal, proposalDoc()],
      [toRevision, revisionDoc()],
      [toChangeRequest, changeRequestDoc()],
      [toMessage, messageDoc()],
    ] as const) {
      const out = (map as (d: typeof doc) => object)(doc);
      expect(out).toMatchObject({ id: doc._id });
      expect(out).not.toHaveProperty('_id');
      expect(out).not.toHaveProperty('companyId');
    }
  });

  it('keep the internal agreement link out of the proposal view', () => {
    expect(toProposal(proposalDoc({ agreementId: 'agr-1' }))).not.toHaveProperty('agreementId');
  });
});

describe('partyOf', () => {
  it('staff are the seller, everyone else the buyer', () => {
    expect(partyOf(request(ADMIN))).toBe(Party.Seller);
    expect(partyOf(request(STAFF))).toBe(Party.Seller);
    expect(partyOf(request(BUYER))).toBe(Party.Buyer);
    expect(partyOf(request(keyHolder('proposal-1')))).toBe(Party.Buyer);
  });
});

describe('loadProposalFor', () => {
  beforeEach(() => {
    repo.col('proposals').findOne.mockResolvedValue(proposalDoc());
  });

  it("staff see any of their company's proposals", async () => {
    expect(await loadProposalFor(request(STAFF), 'proposal-1')).toEqual(proposalDoc());
    expect(repo.col('proposals').findOne).toHaveBeenCalledWith({ _id: 'proposal-1' });
  });

  it('a buyer sees only their own proposal', async () => {
    expect(await loadProposalFor(request(BUYER), 'proposal-1')).toEqual(proposalDoc());
    await expect(
      loadProposalFor(request({ ...BUYER, sub: 'someone-else' }), 'proposal-1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a key holder sees only the proposal their key opens, while the key is active', async () => {
    expect(await loadProposalFor(request(keyHolder('proposal-1')), 'proposal-1')).toEqual(
      proposalDoc(),
    );
    expect(assertKeyActive).toHaveBeenCalledTimes(1);

    await expect(
      loadProposalFor(request(keyHolder('proposal-2')), 'proposal-1'),
    ).rejects.toMatchObject({ status: 404 });

    vi.mocked(assertKeyActive).mockRejectedValueOnce(
      Object.assign(new Error('Not found'), { status: 404 }),
    );
    await expect(
      loadProposalFor(request(keyHolder('proposal-1')), 'proposal-1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('is a 404 when missing or anonymous', async () => {
    await expect(loadProposalFor(request(), 'proposal-1')).rejects.toMatchObject({ status: 404 });
    repo.col('proposals').findOne.mockResolvedValue(null);
    await expect(loadProposalFor(request(STAFF), 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses other roles', async () => {
    await expect(
      loadProposalFor(request({ ...BUYER, role: Role.SuperAdmin }), 'proposal-1'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('addMessage', () => {
  it('stores a message on the proposal timeline', async () => {
    await addMessage(repo, 'proposal-1', Party.Seller, 'Sam', 'Hi', NOW);
    expect(repo.col('proposalMessages').insertOne).toHaveBeenCalledWith({
      _id: 'new-id',
      proposalId: 'proposal-1',
      party: Party.Seller,
      authorName: 'Sam',
      body: 'Hi',
      createdAt: NOW_ISO,
    });
  });
});

describe('loadDetail', () => {
  it('collects revisions, change requests and messages in order, with the viewer party', async () => {
    repo.col('revisions').find.mockResolvedValue([revisionDoc()]);
    repo.col('changeRequests').find.mockResolvedValue([changeRequestDoc()]);
    repo.col('proposalMessages').find.mockResolvedValue([messageDoc()]);

    expect(await loadDetail(request(BUYER), proposalDoc())).toEqual({
      proposal: toProposal(proposalDoc()),
      revisions: [toRevision(revisionDoc())],
      changeRequests: [toChangeRequest(changeRequestDoc())],
      messages: [toMessage(messageDoc())],
      viewerParty: Party.Buyer,
    });
    expect(repo.col('revisions').find).toHaveBeenCalledWith(
      { proposalId: 'proposal-1' },
      { sort: { number: 1 } },
    );
    expect(repo.col('changeRequests').find).toHaveBeenCalledWith(
      { proposalId: 'proposal-1' },
      { sort: { createdAt: 1 } },
    );
    expect(repo.col('proposalMessages').find).toHaveBeenCalledWith(
      { proposalId: 'proposal-1' },
      { sort: { createdAt: 1 } },
    );
    expect(repo.col('agreements').findOne).not.toHaveBeenCalled();
  });

  it('includes the purchase agreement: for the seller as a draft, for the buyer once sent', async () => {
    const signed = proposalDoc({ status: ProposalStatus.Signed, agreementId: 'agr-1' });
    repo.col('agreements').findOne.mockResolvedValue(agreementDoc());
    expect((await loadDetail(request(STAFF), signed)).agreement).toMatchObject({
      id: 'agr-1',
      status: AgreementStatus.Draft,
    });
    expect(repo.col('agreements').findOne).toHaveBeenCalledWith({ _id: 'agr-1' });
    expect(await loadDetail(request(BUYER), signed)).not.toHaveProperty('agreement');

    repo
      .col('agreements')
      .findOne.mockResolvedValue(
        agreementDoc({ status: AgreementStatus.UnderReview, issuedAt: NOW_ISO }),
      );
    expect((await loadDetail(request(keyHolder('proposal-1')), signed)).agreement).toMatchObject({
      id: 'agr-1',
      status: AgreementStatus.UnderReview,
    });
  });
});

describe('authorName', () => {
  it('uses the signed-in name, or the invited buyer name for key holders', () => {
    const doc = proposalDoc({ buyer: { name: 'Invited Ivy' } });
    expect(authorName(request(BUYER), doc)).toBe('Bea Buyer');
    expect(authorName(request(keyHolder('proposal-1')), doc)).toBe('Invited Ivy');
    expect(authorName(request(keyHolder('proposal-1')), proposalDoc({ buyer: {} }))).toBe('Buyer');
    expect(authorName(request(), doc)).toBe('Buyer');
  });
});

describe('packageContents', () => {
  it('lists the items of a package', () => {
    const contents = packageContents(catalog());
    expect(contents('pkg-signature')).toEqual(['item-island', 'item-hood']);
    expect(contents('unknown')).toBeUndefined();
  });
});

describe('describeChange', () => {
  const withPackage = { kitchen: { packageId: 'pkg-standard' } };
  const withItems = { kitchen: { itemIds: ['item-hood'] } };
  const c = catalog();

  it.each([
    [
      { type: 'add_item', areaSlug: 'kitchen', itemId: 'item-island' },
      withPackage,
      'Add Island to Standard items (Kitchen)',
    ],
    [
      { type: 'add_item', areaSlug: 'kitchen', itemId: 'item-island' },
      withItems,
      'Add Island (Kitchen)',
    ],
    [
      { type: 'remove_item', areaSlug: 'kitchen', itemId: 'item-hood' },
      withPackage,
      'Remove Range hood from Standard package (Kitchen)',
    ],
    [
      { type: 'remove_item', areaSlug: 'kitchen', itemId: 'item-hood' },
      withItems,
      'Remove Range hood (Kitchen)',
    ],
    [
      { type: 'remove_package', areaSlug: 'kitchen' },
      withPackage,
      'Remove Standard package (Kitchen)',
    ],
    [
      { type: 'set_package', areaSlug: 'kitchen', packageId: 'pkg-signature' },
      withPackage,
      'Change Kitchen: Standard → Signature',
    ],
    [
      { type: 'set_package', areaSlug: 'kitchen', packageId: 'pkg-signature' },
      {},
      'Choose Signature package (Kitchen)',
    ],
    [{ type: 'add_item', areaSlug: 'patio', itemId: 'gone' }, {}, 'Add option (patio)'],
    [{ type: 'remove_package', areaSlug: 'kitchen' }, {}, 'Remove package package (Kitchen)'],
  ] as const)('%o on %o reads "%s"', (change, base, label) => {
    expect(describeChange(change, base, c)).toBe(label);
  });
});
