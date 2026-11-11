import { AccessKeyStatus, AccessResourceType, GuestRole } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_SESSION_TTL_S } from '../../../src/auth/tokens.js';
import { findAccessKeyByHash } from '../../../src/data/access-key-lookup.js';
import { accessRoutes, adminAccessKeyRoutes } from '../../../src/modules/access-keys/routes.js';
import { createAccessKey, toKeyInfo } from '../../../src/modules/access-keys/keys.js';
import { accessKeyDoc, PLAIN_KEY } from '../../support/fixtures.js';
import {
  BUYER,
  COMPANY_TENANT,
  NOW,
  NOW_ISO,
  STAFF,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockContext,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/data/access-key-lookup.js', () => ({ findAccessKeyByHash: vi.fn() }));
vi.mock('../../../src/data/ids.js', () => ({
  sha256: vi.fn((v: string) => `sha256(${v})`),
  randomCode: vi.fn(() => 'WXYZ-1234'),
}));
vi.mock('../../../src/modules/access-keys/keys.js', () => ({
  createAccessKey: vi.fn(),
  hashCode: vi.fn((id: string, code: string) => `hash(${id}:${code})`),
  toKeyInfo: vi.fn(),
}));

let h: Harness;
let repo: MockRepo;
let scene: Scene;
let ctx: MockContext;

const serve = async (router: 'access' | 'admin', overrides = {}) => {
  ctx = mockContext(overrides);
  h = await serveRouter(router === 'access' ? accessRoutes(ctx) : adminAccessKeyRoutes(ctx), scene);
};

beforeEach(() => {
  repo = mockRepo();
  scene = { tenant: COMPANY_TENANT, repo };
  vi.mocked(toKeyInfo).mockImplementation((d) => ({ info: d._id }) as never);
});
afterEach(() => h.close());

describe('POST /access/session', () => {
  beforeEach(() => serve('access'));

  it('exchanges an active key for a scoped key-holder token', async () => {
    vi.mocked(findAccessKeyByHash).mockResolvedValue(accessKeyDoc());
    ctx.tokens.sign.mockResolvedValue('key-session-jwt');
    const res = await h.call('POST', '/session', { key: PLAIN_KEY });
    expect(res).toMatchObject({
      status: 200,
      body: {
        accessToken: 'key-session-jwt',
        expiresIn: KEY_SESSION_TTL_S,
        resourceType: AccessResourceType.Proposal,
        resourceId: 'proposal-1',
      },
    });
    expect(findAccessKeyByHash).toHaveBeenCalledWith(ctx.db, `sha256(${PLAIN_KEY})`);
    expect(ctx.tokens.sign).toHaveBeenCalledWith(
      {
        sub: 'key-1',
        role: GuestRole.KeyHolder,
        companyId: COMPANY_TENANT.companyId,
        name: 'Guest',
        resource: { type: AccessResourceType.Proposal, id: 'proposal-1' },
      },
      KEY_SESSION_TTL_S,
    );
    expect(repo.col('accessKeys').updateOne).toHaveBeenCalledWith(
      { _id: 'key-1' },
      { $set: { lastUsedAt: NOW_ISO } },
    );
  });

  it('refuses unknown, revoked and claimed keys with 404', async () => {
    for (const doc of [
      null,
      accessKeyDoc({ status: AccessKeyStatus.Revoked }),
      accessKeyDoc({ status: AccessKeyStatus.Claimed }),
    ]) {
      vi.mocked(findAccessKeyByHash).mockResolvedValueOnce(doc);
      expect(await h.call('POST', '/session', { key: PLAIN_KEY })).toMatchObject({
        status: 404,
        body: { error: 'Invalid or revoked access key' },
      });
    }
    expect(ctx.tokens.sign).not.toHaveBeenCalled();
  });

  it("refuses another company's key on this origin with 403", async () => {
    vi.mocked(findAccessKeyByHash).mockResolvedValue(accessKeyDoc({ companyId: 'company-b' }));
    expect(await h.call('POST', '/session', { key: PLAIN_KEY })).toMatchObject({
      status: 403,
      body: { error: 'Key not valid for this origin' },
    });
    expect(repo.col('accessKeys').updateOne).not.toHaveBeenCalled();
  });

  it('validates the key shape and never echoes it', async () => {
    const res = await h.call('POST', '/session', { key: 'short' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('short');
  });

  it('a signing link needs its code as well, and carries the purchaser it signs for', async () => {
    const signingKey = accessKeyDoc({
      resourceType: AccessResourceType.Agreement,
      resourceId: 'agr-1',
      codeHash: 'hash(key-1:ABCD-EFGH)',
      signerId: 'pur-2',
    });
    vi.mocked(findAccessKeyByHash).mockResolvedValue(signingKey);
    ctx.tokens.sign.mockResolvedValue('signer-jwt');

    expect(await h.call('POST', '/session', { key: PLAIN_KEY })).toMatchObject({
      status: 422,
      body: { error: 'This link needs the code that was sent to you' },
    });
    expect(await h.call('POST', '/session', { key: PLAIN_KEY, code: 'NOPE-NOPE' })).toMatchObject({
      status: 404,
      body: { error: 'Invalid or revoked access key' },
    });
    expect(ctx.tokens.sign).not.toHaveBeenCalled();

    const res = await h.call('POST', '/session', { key: PLAIN_KEY, code: 'abcd-efgh' });
    expect(res).toMatchObject({
      status: 200,
      body: {
        accessToken: 'signer-jwt',
        resourceType: AccessResourceType.Agreement,
        resourceId: 'agr-1',
        signerId: 'pur-2',
      },
    });
    expect(ctx.tokens.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: { type: AccessResourceType.Agreement, id: 'agr-1' },
        signerId: 'pur-2',
      }),
      KEY_SESSION_TTL_S,
    );
  });
});

describe('access key rate limit', () => {
  it('blocks an IP after N failed lookups on this tenant (429); successes do not count', async () => {
    await serve('access', { accessKeyRateLimit: { windowMs: 60_000, max: 2 } });
    vi.mocked(findAccessKeyByHash).mockResolvedValue(accessKeyDoc());
    for (let i = 0; i < 3; i++) {
      expect((await h.call('POST', '/session', { key: PLAIN_KEY })).status).toBe(200);
    }
    vi.mocked(findAccessKeyByHash).mockResolvedValue(null);
    expect((await h.call('POST', '/session', { key: PLAIN_KEY })).status).toBe(404);
    expect((await h.call('POST', '/session', { key: PLAIN_KEY })).status).toBe(404);
    expect(await h.call('POST', '/session', { key: PLAIN_KEY })).toMatchObject({
      status: 429,
      body: { error: 'Too many attempts, try again later' },
    });
  });
});

describe('POST /access/claim', () => {
  beforeEach(async () => {
    scene.principal = BUYER;
    await serve('access');
  });

  it('a signed-in buyer adopts the proposal and the key stops working', async () => {
    repo.col('accessKeys').findOne.mockResolvedValue(accessKeyDoc());
    expect(await h.call('POST', '/claim', { key: PLAIN_KEY })).toMatchObject({
      status: 200,
      body: { resourceType: AccessResourceType.Proposal, resourceId: 'proposal-1' },
    });
    expect(repo.col('accessKeys').findOne).toHaveBeenCalledWith({ hash: `sha256(${PLAIN_KEY})` });
    expect(repo.col('accessKeys').updateOne).toHaveBeenCalledWith(
      { _id: 'key-1', status: AccessKeyStatus.Active },
      { $set: { status: AccessKeyStatus.Claimed, lastUsedAt: NOW_ISO } },
    );
    expect(repo.col('proposals').updateOne).toHaveBeenCalledWith(
      { _id: 'proposal-1' },
      { $set: { buyerUserId: 'buyer-1' } },
    );
  });

  it('a signing link belongs to one purchaser and is never adopted', async () => {
    repo
      .col('accessKeys')
      .findOne.mockResolvedValue(
        accessKeyDoc({ resourceType: AccessResourceType.Agreement, resourceId: 'agr-1' }),
      );
    expect(await h.call('POST', '/claim', { key: PLAIN_KEY })).toMatchObject({
      status: 422,
      body: { error: 'This link cannot be added to an account' },
    });
    expect(repo.col('accessKeys').updateOne).not.toHaveBeenCalled();
  });

  it('a key used meanwhile is a 409; unknown or inactive keys are a 404', async () => {
    repo.col('accessKeys').findOne.mockResolvedValue(accessKeyDoc());
    repo.col('accessKeys').updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    expect((await h.call('POST', '/claim', { key: PLAIN_KEY })).status).toBe(409);
    expect(repo.col('proposals').updateOne).not.toHaveBeenCalled();
    repo
      .col('accessKeys')
      .findOne.mockResolvedValue(accessKeyDoc({ status: AccessKeyStatus.Claimed }));
    expect((await h.call('POST', '/claim', { key: PLAIN_KEY })).status).toBe(404);
  });

  it('is for signed-in buyers only', async () => {
    scene.principal = STAFF;
    expect((await h.call('POST', '/claim', { key: PLAIN_KEY })).status).toBe(403);
    delete scene.principal;
    expect((await h.call('POST', '/claim', { key: PLAIN_KEY })).status).toBe(401);
  });
});

describe('admin access keys', () => {
  beforeEach(async () => {
    scene.principal = STAFF;
    await serve('admin');
  });

  it('is staff-only', async () => {
    scene.principal = BUYER;
    expect((await h.call('GET', '/?resourceType=proposal&resourceId=p')).status).toBe(403);
  });

  it("lists a resource's keys, newest first", async () => {
    repo.col('accessKeys').find.mockResolvedValue([accessKeyDoc()]);
    expect((await h.call('GET', '/?resourceType=proposal&resourceId=proposal-1')).body).toEqual([
      { info: 'key-1' },
    ]);
    expect(repo.col('accessKeys').find).toHaveBeenCalledWith(
      { resourceType: AccessResourceType.Proposal, resourceId: 'proposal-1' },
      { sort: { createdAt: -1 } },
    );
    expect((await h.call('GET', '/?resourceType=house')).status).toBe(400);
  });

  it('revokes an active key, or 404', async () => {
    repo
      .col('accessKeys')
      .findOneAndUpdate.mockResolvedValueOnce(accessKeyDoc({ status: AccessKeyStatus.Revoked }));
    expect((await h.call('POST', '/key-1/revoke')).body).toEqual({ info: 'key-1' });
    expect(repo.col('accessKeys').findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'key-1', status: AccessKeyStatus.Active },
      { $set: { status: AccessKeyStatus.Revoked } },
    );
    expect((await h.call('POST', '/key-1/revoke')).status).toBe(404);
  });

  it('rotates a key: revokes the old one, issues a new one and points the proposal to it', async () => {
    repo.col('accessKeys').findOneAndUpdate.mockResolvedValue(accessKeyDoc());
    vi.mocked(createAccessKey).mockResolvedValue({
      key: 'new-plain-key',
      doc: accessKeyDoc({ _id: 'key-2' }),
    });
    expect(await h.call('POST', '/key-1/rotate')).toMatchObject({
      status: 201,
      body: { accessKey: 'new-plain-key', key: { info: 'key-2' } },
    });
    expect(createAccessKey).toHaveBeenCalledWith(repo, AccessResourceType.Proposal, 'proposal-1', {
      createdBy: 'staff-1',
      now: NOW,
    });
    expect(repo.col('proposals').updateOne).toHaveBeenCalledWith(
      { _id: 'proposal-1' },
      { $set: { accessKeyId: 'key-2' } },
    );
  });

  it('rotating a signing link issues a new code for the same purchaser', async () => {
    repo.col('accessKeys').findOneAndUpdate.mockResolvedValue(
      accessKeyDoc({
        resourceType: AccessResourceType.Agreement,
        resourceId: 'agr-1',
        codeHash: 'hash(key-1:ABCD-EFGH)',
        signerId: 'pur-2',
      }),
    );
    vi.mocked(createAccessKey).mockResolvedValue({
      key: 'new-plain-key',
      doc: accessKeyDoc({ _id: 'key-2', resourceType: AccessResourceType.Agreement }),
    });
    expect(await h.call('POST', '/key-1/rotate')).toMatchObject({
      status: 201,
      body: { accessKey: 'new-plain-key', code: 'WXYZ-1234' },
    });
    expect(createAccessKey).toHaveBeenCalledWith(repo, AccessResourceType.Agreement, 'agr-1', {
      createdBy: 'staff-1',
      now: NOW,
      code: 'WXYZ-1234',
      signerId: 'pur-2',
    });
    expect(repo.col('proposals').updateOne).not.toHaveBeenCalled();
  });

  it('rotating an inactive key is a 404', async () => {
    expect((await h.call('POST', '/key-1/rotate')).status).toBe(404);
    expect(createAccessKey).not.toHaveBeenCalled();
  });
});
