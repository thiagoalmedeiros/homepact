import { STARTER_AGREEMENT_TEMPLATE } from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agreementTemplateRoutes } from '../../../src/modules/agreement-templates/routes.js';
import { toTemplate } from '../../../src/modules/agreement-templates/store.js';
import { templateDoc } from '../../support/fixtures.js';
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

vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'tpl-new') }));

let h: Harness;
let repo: MockRepo;
let scene: Scene;
const templates = () => repo.col('agreementTemplates');
const body = { ...STARTER_AGREEMENT_TEMPLATE, isDefault: false };

beforeEach(async () => {
  repo = mockRepo();
  scene = { tenant: COMPANY_TENANT, repo, principal: ADMIN };
  h = await serveRouter(agreementTemplateRoutes(mockContext()), scene);
});
afterEach(() => h.close());

describe('toTemplate', () => {
  it('exposes _id as id and never the company', () => {
    const out = toTemplate(templateDoc());
    expect(out).toMatchObject({ id: 'tpl-1', name: 'Standard agreement', version: 2 });
    expect(out).not.toHaveProperty('_id');
    expect(out).not.toHaveProperty('companyId');
  });
});

describe('access', () => {
  it('is for signed-in company staff only', async () => {
    delete scene.principal;
    expect((await h.call('GET', '/')).status).toBe(401);
    scene.principal = BUYER;
    expect((await h.call('GET', '/')).status).toBe(403);
  });

  it('sales staff can read templates but only administrators can change them', async () => {
    scene.principal = STAFF;
    templates().find.mockResolvedValue([templateDoc()]);
    expect((await h.call('GET', '/')).body).toEqual([toTemplate(templateDoc())]);
    for (const [method, path] of [
      ['POST', '/'],
      ['PUT', '/tpl-1'],
      ['DELETE', '/tpl-1'],
    ] as const) {
      expect((await h.call(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    expect(templates().insertOne).not.toHaveBeenCalled();
    expect(templates().findOneAndUpdate).not.toHaveBeenCalled();
    expect(templates().deleteOne).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('lists the company templates by name', async () => {
    await h.call('GET', '/');
    expect(templates().find).toHaveBeenCalledWith({}, { sort: { name: 1 } });
  });

  it('reads one template, 404 when it is not this company’s', async () => {
    templates().findOne.mockResolvedValueOnce(templateDoc());
    expect((await h.call('GET', '/tpl-1')).body).toMatchObject({ id: 'tpl-1' });
    expect(templates().findOne).toHaveBeenCalledWith({ _id: 'tpl-1' });
    expect((await h.call('GET', '/other-company-template')).status).toBe(404);
  });
});

describe('POST /', () => {
  it('the first template of a company becomes its default', async () => {
    templates().countDocuments.mockResolvedValue(0);
    const res = await h.call('POST', '/', body);
    expect(res.status).toBe(201);
    expect(templates().insertOne).toHaveBeenCalledWith({
      _id: 'tpl-new',
      ...STARTER_AGREEMENT_TEMPLATE,
      isDefault: true,
      version: 1,
      updatedByName: 'Alex Admin',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    expect(res.body).toMatchObject({ id: 'tpl-new', isDefault: true, version: 1 });
    expect(templates().updateMany).toHaveBeenCalledWith(
      { _id: { $ne: 'tpl-new' }, isDefault: true },
      { $set: { isDefault: false } },
    );
  });

  it('later templates are not the default unless asked, which demotes the others', async () => {
    templates().countDocuments.mockResolvedValue(3);
    await h.call('POST', '/', body);
    expect(templates().insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: false }),
    );
    expect(templates().updateMany).not.toHaveBeenCalled();

    await h.call('POST', '/', { ...body, isDefault: true });
    expect(templates().updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a misspelled merge field, pointing at the section', async () => {
    const res = await h.call('POST', '/', {
      ...body,
      sections: [{ heading: 'Price', body: 'It costs {{price.totl}}' }],
    });
    expect(res).toMatchObject({
      status: 400,
      body: { details: { 'sections.0.body': ['Unknown field {{price.totl}}'] } },
    });
    expect(templates().insertOne).not.toHaveBeenCalled();
  });

  it('names are unique within the company', async () => {
    templates().insertOne.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    expect(await h.call('POST', '/', body)).toMatchObject({
      status: 409,
      body: { error: 'A template with this name already exists' },
    });
  });
});

describe('PUT /:id', () => {
  it('replaces the text and bumps the version; existing agreements keep their own copy', async () => {
    templates().findOneAndUpdate.mockResolvedValue(templateDoc({ isDefault: false, version: 3 }));
    const res = await h.call('PUT', '/tpl-1', body);
    expect(res).toMatchObject({ status: 200, body: { version: 3 } });
    expect(templates().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'tpl-1' },
      {
        $set: { ...body, updatedByName: 'Alex Admin', updatedAt: NOW_ISO },
        $inc: { version: 1 },
      },
    );
    expect(templates().updateMany).not.toHaveBeenCalled();
    expect(repo.of).not.toHaveBeenCalledWith('agreements');
  });

  it('making it the default demotes the others', async () => {
    templates().findOneAndUpdate.mockResolvedValue(templateDoc({ isDefault: true }));
    await h.call('PUT', '/tpl-1', { ...body, isDefault: true });
    expect(templates().updateMany).toHaveBeenCalledWith(
      { _id: { $ne: 'tpl-1' }, isDefault: true },
      { $set: { isDefault: false } },
    );
  });

  it('404 for an unknown template, 409 for a name already in use', async () => {
    expect((await h.call('PUT', '/nope', body)).status).toBe(404);
    templates().findOneAndUpdate.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    expect((await h.call('PUT', '/tpl-1', body)).status).toBe(409);
  });

  it('other errors are not swallowed', async () => {
    templates().findOneAndUpdate.mockRejectedValue(new Error('db down'));
    expect((await h.call('PUT', '/tpl-1', body)).status).toBe(500);
    templates().insertOne.mockRejectedValue(new Error('db down'));
    expect((await h.call('POST', '/', body)).status).toBe(500);
  });
});

describe('DELETE /:id', () => {
  it('deletes the template; 404 when unknown', async () => {
    expect((await h.call('DELETE', '/tpl-1')).status).toBe(204);
    expect(templates().deleteOne).toHaveBeenCalledWith({ _id: 'tpl-1' });
    templates().deleteOne.mockResolvedValue({ deletedCount: 0 });
    expect((await h.call('DELETE', '/tpl-1')).status).toBe(404);
  });
});
