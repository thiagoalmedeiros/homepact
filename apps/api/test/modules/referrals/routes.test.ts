import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { referralProgramRoutes } from '../../../src/modules/referrals/routes.js';
import { toReferralProgram } from '../../../src/modules/referrals/store.js';
import { referralProgramDoc } from '../../support/fixtures.js';
import {
  ADMIN,
  BUYER,
  COMPANY_TENANT,
  NOW_ISO,
  STAFF,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'prog-new') }));

let h: Harness;
let repo: MockRepo;
let scene: Scene;
const programs = () => repo.col('referralPrograms');
const body = { name: 'Refer a friend', creditCents: 200_000 };

beforeEach(async () => {
  repo = mockRepo();
  scene = { tenant: COMPANY_TENANT, repo, principal: ADMIN };
  h = await serveRouter(referralProgramRoutes(mockContext()), scene);
});
afterEach(() => h.close());

describe('access', () => {
  it('is for signed-in company staff; only administrators change programs', async () => {
    delete scene.principal;
    expect((await h.call('GET', '/')).status).toBe(401);
    scene.principal = BUYER;
    expect((await h.call('GET', '/')).status).toBe(403);
    scene.principal = STAFF;
    programs().find.mockResolvedValue([referralProgramDoc()]);
    expect((await h.call('GET', '/')).body).toEqual([toReferralProgram(referralProgramDoc())]);
    expect(programs().find).toHaveBeenCalledWith({}, { sort: { name: 1 } });
    for (const [method, path] of [
      ['POST', '/'],
      ['PATCH', '/prog-1'],
      ['DELETE', '/prog-1'],
    ] as const) {
      expect((await h.call(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    expect(programs().insertOne).not.toHaveBeenCalled();
  });
});

describe('writing programs', () => {
  it('creates an active program with its credit', async () => {
    const res = await h.call('POST', '/', body);
    expect(res).toMatchObject({ status: 201, body: { id: 'prog-new', active: true } });
    expect(programs().insertOne).toHaveBeenCalledWith({
      _id: 'prog-new',
      name: 'Refer a friend',
      creditCents: 200_000,
      active: true,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    expect((await h.call('POST', '/', { ...body, creditCents: -5 })).status).toBe(400);
  });

  it('patches only what is sent, e.g. ending a program', async () => {
    programs().findOneAndUpdate.mockResolvedValue(referralProgramDoc({ active: false }));
    expect((await h.call('PATCH', '/prog-1', { active: false })).body).toMatchObject({
      active: false,
    });
    expect(programs().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'prog-1' },
      { $set: { active: false, updatedAt: NOW_ISO } },
    );
    programs().findOneAndUpdate.mockResolvedValue(null);
    expect((await h.call('PATCH', '/other', { active: false })).status).toBe(404);
  });

  it('deletes a program; proposals keep their copy of it', async () => {
    expect((await h.call('DELETE', '/prog-1')).status).toBe(204);
    expect(programs().deleteOne).toHaveBeenCalledWith({ _id: 'prog-1' });
    programs().deleteOne.mockResolvedValue({ deletedCount: 0 });
    expect((await h.call('DELETE', '/prog-1')).status).toBe(404);
  });
});
