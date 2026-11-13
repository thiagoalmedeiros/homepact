import {
  AgreementStatus,
  InstalmentStatus,
  PaymentAction,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  Role,
  type PaymentActor,
} from '@homepact/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgreementDoc } from '../../../src/modules/agreements/store.js';
import {
  agreementPaymentRoutes,
  paymentQueueRoutes,
} from '../../../src/modules/payments/routes.js';
import type { PaymentDoc } from '../../../src/modules/payments/store.js';
import { addMessage, loadProposalFor } from '../../../src/modules/proposals/store.js';
import { agreementDoc, paymentDoc } from '../../support/fixtures.js';
import {
  ADMIN,
  BUYER,
  COMPANY_TENANT,
  FINANCE,
  NOW_ISO,
  STAFF,
  agreementSigner,
  keyHolder,
  mockContext,
  mockRepo,
  serveRouter,
  type Harness,
  type MockRepo,
  type Scene,
} from '../../support/mocks.js';
import express from 'express';

vi.mock('../../../src/data/ids.js', () => ({
  newId: vi.fn(() => 'pay-new'),
  reference: vi.fn(() => 'PAY-TEST-0001'),
}));
vi.mock('../../../src/modules/proposals/store.js', () => ({
  addMessage: vi.fn(),
  loadProposalFor: vi.fn(),
}));

const signed = (over: Partial<AgreementDoc> = {}) =>
  agreementDoc({ status: AgreementStatus.Signed, issuedAt: NOW_ISO, ...over });
const SALES_ACTOR: PaymentActor = { id: 'staff-1', name: 'Sam Staff', role: Role.CompanyStaff };
const FINANCE_ACTOR: PaymentActor = {
  id: 'finance-1',
  name: 'Fran Finance',
  role: Role.CompanyFinance,
};
const pending = (over: Partial<PaymentDoc> = {}) =>
  paymentDoc({
    _id: 'pay-p',
    reference: 'PAY-PEND-0001',
    status: PaymentStatus.Pending,
    recordedBy: SALES_ACTOR,
    history: [{ at: NOW_ISO, by: SALES_ACTOR, action: PaymentAction.Recorded }],
    ...over,
  });
const body = {
  amountCents: 500_000,
  receivedOn: '2026-10-31',
  method: PaymentMethod.Wire,
  externalRef: 'W-77',
};

let h: Harness;
let repo: MockRepo;
let scene: Scene;
let agreement: AgreementDoc | null;
let ledger: PaymentDoc[];

/** Just enough of a MongoDB filter for these routes: equality and `$in`. */
const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([key, want]) => {
    const have = key.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], doc);
    if (want && typeof want === 'object' && '$in' in want) {
      return (want.$in as unknown[]).includes(have);
    }
    if (want && typeof want === 'object' && '$exists' in want) {
      return (have !== undefined) === want.$exists;
    }
    return have === want;
  });

const payments = () => repo.col('agreementPayments');
const lastSet = () =>
  payments().findOneAndUpdate.mock.calls.at(-1)?.[1] as {
    $set: Record<string, unknown>;
    $unset?: Record<string, unknown>;
  };
const thread = () => vi.mocked(addMessage).mock.calls.map((c) => [c[1], c[4]]);

beforeEach(async () => {
  repo = mockRepo();
  scene = { tenant: COMPANY_TENANT, repo, principal: FINANCE };
  agreement = signed();
  ledger = [];
  repo.col('agreements').findOne.mockImplementation(async () => agreement);
  payments().find.mockImplementation(async (filter: Record<string, unknown>) =>
    ledger.filter((e) => matches(e, filter)),
  );
  payments().findOne.mockImplementation(
    async (filter: Record<string, unknown>) => ledger.find((e) => matches(e, filter)) ?? null,
  );
  payments().findOneAndUpdate.mockImplementation(
    async (filter: Record<string, unknown>, update: { $set: object }) => {
      const doc = ledger.find((e) => matches(e, filter));
      return doc ? { ...doc, ...update.$set } : null;
    },
  );
  vi.mocked(loadProposalFor).mockResolvedValue({} as never);
  const app = express.Router();
  const ctx = mockContext();
  app.use('/agreements/:agreementId/payments', agreementPaymentRoutes(ctx));
  app.use('/agreement-payments', paymentQueueRoutes(ctx));
  h = await serveRouter(app, scene);
});
afterEach(() => h.close());

const URL = '/agreements/agr-1/payments';

describe('access', () => {
  it('every endpoint needs a signed-in user', async () => {
    delete scene.principal;
    for (const [method, path] of [
      ['GET', URL],
      ['POST', URL],
      ['PUT', `${URL}/pay-1`],
      ['POST', `${URL}/pay-1/approve`],
      ['GET', '/agreement-payments'],
    ] as const) {
      expect((await h.call(method, path, {})).status, path).toBe(401);
    }
  });

  it('buyers read; they never record, approve, reject, withdraw or void', async () => {
    ledger = [pending()];
    scene.principal = BUYER;
    for (const [method, path] of [
      ['POST', URL],
      ['PUT', `${URL}/pay-p`],
      ['POST', `${URL}/pay-p/approve`],
      ['POST', `${URL}/pay-p/reject`],
      ['POST', `${URL}/pay-p/withdraw`],
      ['POST', `${URL}/pay-p/void`],
      ['GET', '/agreement-payments'],
    ] as const) {
      expect((await h.call(method, path, { reason: 'because' })).status, path).toBe(403);
    }
    expect(payments().insertOne).not.toHaveBeenCalled();
    expect(payments().findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('sales record, but approving, rejecting and voiding are for finance and administrators', async () => {
    ledger = [pending({ recordedBy: { ...SALES_ACTOR, id: 'staff-2' } }), paymentDoc()];
    scene.principal = STAFF;
    for (const path of [`${URL}/pay-p/approve`, `${URL}/pay-p/reject`, `${URL}/pay-1/void`]) {
      expect((await h.call('POST', path, { reason: 'because' })).status, path).toBe(403);
    }
    for (const who of [FINANCE, ADMIN]) {
      scene.principal = who;
      ledger = [pending()];
      expect((await h.call('POST', `${URL}/pay-p/approve`)).status).toBe(200);
    }
  });
});

describe('GET /agreements/:id/payments', () => {
  it('company users see every entry, whatever its status, and the schedule it leaves', async () => {
    ledger = [
      paymentDoc(),
      pending({ amountCents: 300_000 }),
      paymentDoc({ _id: 'pay-v', status: PaymentStatus.Voided, voidReason: 'NSF' }),
    ];
    for (const who of [FINANCE, STAFF, ADMIN]) {
      scene.principal = who;
      const res = await h.call('GET', URL);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        agreementId: 'agr-1',
        agreementReference: 'A-TEST-0001',
        agreementStatus: AgreementStatus.Signed,
        currency: 'CAD',
      });
      expect(res.body.payments.map((p: { id: string }) => p.id)).toEqual([
        'pay-1',
        'pay-p',
        'pay-v',
      ]);
      expect(res.body.payments[0]).not.toHaveProperty('companyId');
      expect(res.body.schedule.lines[0]).toMatchObject({
        paidCents: 1_000_000,
        remainingCents: 1_500_000,
        status: InstalmentStatus.Partial,
      });
      expect(res.body.schedule.totals).toMatchObject({
        netPaidCents: 1_000_000,
        pendingCents: 300_000,
        pendingCount: 1,
      });
    }
    expect(payments().find).toHaveBeenCalledWith(
      { agreementId: 'agr-1' },
      { sort: { receivedOn: 1, recordedAt: 1 } },
    );
    expect(loadProposalFor).not.toHaveBeenCalled();
  });

  it('the buyer sees posted entries only, without internal notes or staff names', async () => {
    ledger = [paymentDoc({ note: 'Left at the sales office' }), pending()];
    for (const who of [BUYER, keyHolder('proposal-1')]) {
      scene.principal = who;
      const res = await h.call('GET', URL);
      expect(res.body).toEqual({
        agreementId: 'agr-1',
        agreementReference: 'A-TEST-0001',
        currency: 'CAD',
        schedule: expect.objectContaining({
          totals: expect.objectContaining({ netPaidCents: 1_000_000, pendingCount: 0 }),
        }),
        payments: [
          {
            id: 'pay-1',
            reference: 'PAY-AAAA-0001',
            kind: PaymentKind.Payment,
            amountCents: 1_000_000,
            currency: 'CAD',
            receivedOn: '2026-10-30',
            method: PaymentMethod.Cheque,
          },
        ],
      });
    }
    expect(loadProposalFor).toHaveBeenCalledWith(expect.anything(), 'proposal-1');
  });

  it('buyers see nothing of an agreement that was never sent, or that is not theirs', async () => {
    scene.principal = BUYER;
    agreement = agreementDoc();
    expect((await h.call('GET', URL)).status).toBe(404);
    agreement = signed();
    vi.mocked(loadProposalFor).mockRejectedValue(
      Object.assign(new Error('Not found'), { status: 404, expose: true }),
    );
    expect((await h.call('GET', URL)).status).toBe(404);
  });

  it('a signing link opens the agreement to sign it, not its payments', async () => {
    scene.principal = agreementSigner('agr-1', 'pur-1');
    expect(await h.call('GET', URL)).toMatchObject({
      status: 403,
      body: { error: 'A signing link only opens the agreement to sign it' },
    });
  });

  it('is a 404 for an unknown agreement', async () => {
    agreement = null;
    expect(await h.call('GET', URL)).toMatchObject({
      status: 404,
      body: { error: 'Agreement not found' },
    });
  });
});

describe('POST /agreements/:id/payments (record)', () => {
  it('finance posts a payment at once, and the buyer is told on the proposal thread', async () => {
    const res = await h.call('POST', URL, { ...body, note: 'Deposit, first part' });
    expect(res.status).toBe(201);
    const recorded = {
      _id: 'pay-new',
      reference: 'PAY-TEST-0001',
      agreementId: 'agr-1',
      agreementReference: 'A-TEST-0001',
      kind: PaymentKind.Payment,
      status: PaymentStatus.Posted,
      amountCents: 500_000,
      currency: 'CAD',
      receivedOn: '2026-10-31',
      method: PaymentMethod.Wire,
      externalRef: 'W-77',
      note: 'Deposit, first part',
      recordedBy: FINANCE_ACTOR,
      recordedAt: NOW_ISO,
      history: [{ at: NOW_ISO, by: FINANCE_ACTOR, action: PaymentAction.Recorded }],
      updatedAt: NOW_ISO,
    };
    expect(payments().insertOne).toHaveBeenCalledWith(recorded);
    const { _id, ...rest } = recorded;
    expect(res.body).toEqual({ id: _id, ...rest });
    expect(thread()).toEqual([
      [
        'proposal-1',
        'Payment of $5,000 received on 2026-10-31 for purchase agreement A-TEST-0001.',
      ],
    ]);
    expect(repo.col('proposals').updateOne).toHaveBeenCalledWith(
      { _id: 'proposal-1' },
      { $set: { lastActivityAt: NOW_ISO, updatedAt: NOW_ISO } },
    );
  });

  it('an administrator posts at once too', async () => {
    scene.principal = ADMIN;
    expect((await h.call('POST', URL, body)).body.status).toBe(PaymentStatus.Posted);
  });

  it('sales record it as pending; it counts once approved, so the buyer is not told yet', async () => {
    scene.principal = STAFF;
    const res = await h.call('POST', URL, body);
    expect(res.body).toMatchObject({
      status: PaymentStatus.Pending,
      recordedBy: SALES_ACTOR,
    });
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('takes payments once every purchaser signed, and after execution', async () => {
    for (const status of [AgreementStatus.Draft, AgreementStatus.UnderReview]) {
      agreement = signed({ status });
      expect(await h.call('POST', URL, body)).toMatchObject({
        status: 409,
        body: {
          error: 'Payments can be recorded once every purchaser has signed the agreement',
        },
      });
    }
    agreement = signed({ status: AgreementStatus.Cancelled });
    expect(await h.call('POST', URL, body)).toMatchObject({
      status: 409,
      body: { error: 'This agreement is cancelled; only refunds can be recorded' },
    });
    agreement = signed({ status: AgreementStatus.Executed });
    expect((await h.call('POST', URL, body)).status).toBe(201);
  });

  it('money cannot be received in the future', async () => {
    expect(await h.call('POST', URL, { ...body, receivedOn: '2026-11-01' })).toMatchObject({
      status: 422,
      body: { error: 'The date received cannot be in the future' },
    });
  });

  it('validates the entry', async () => {
    for (const bad of [{ amountCents: 0 }, { receivedOn: 'yesterday' }, { method: 'barter' }]) {
      expect((await h.call('POST', URL, { ...body, ...bad })).status).toBe(400);
    }
    expect(payments().insertOne).not.toHaveBeenCalled();
  });

  it('cannot pass the price, counting entries waiting for approval', async () => {
    ledger = [
      paymentDoc({ amountCents: 49_000_000 }),
      pending({ amountCents: 600_000 }),
      paymentDoc({ _id: 'pay-v', amountCents: 900_000, status: PaymentStatus.Voided }),
    ];
    expect(await h.call('POST', URL, { ...body, amountCents: 400_001 })).toMatchObject({
      status: 422,
      body: {
        error: 'This is more than the $4,000 left to pay, counting payments waiting for approval',
      },
    });
    expect((await h.call('POST', URL, { ...body, amountCents: 400_000 })).status).toBe(201);
  });

  it('asks before recording the same amount, date and reference twice', async () => {
    ledger = [paymentDoc({ amountCents: 500_000, receivedOn: '2026-10-31', externalRef: 'w-77 ' })];
    expect(await h.call('POST', URL, body)).toMatchObject({
      status: 409,
      body: {
        error:
          'A payment with the same amount, date and reference is already recorded; confirm to record it anyway',
        details: { duplicateOf: ['PAY-AAAA-0001'] },
      },
    });
    expect((await h.call('POST', URL, { ...body, allowDuplicate: true })).status).toBe(201);
  });

  it('a voided or rejected twin is no duplicate', async () => {
    ledger = [
      paymentDoc({ amountCents: 500_000, receivedOn: '2026-10-31', externalRef: 'W-77' }),
    ].map((p) => ({ ...p, status: PaymentStatus.Voided }));
    expect((await h.call('POST', URL, body)).status).toBe(201);
  });

  describe('refunds', () => {
    const refund = { ...body, kind: PaymentKind.Refund, amountCents: 400_000 };

    it('are for finance and administrators only', async () => {
      ledger = [paymentDoc()];
      scene.principal = STAFF;
      expect(await h.call('POST', URL, refund)).toMatchObject({
        status: 403,
        body: { error: 'Only finance or an administrator can record a refund' },
      });
    });

    it('go out on cancelled agreements, posted at once, and the buyer is told', async () => {
      agreement = signed({ status: AgreementStatus.Cancelled });
      ledger = [paymentDoc()];
      const res = await h.call('POST', URL, refund);
      expect(res.body).toMatchObject({ kind: PaymentKind.Refund, status: PaymentStatus.Posted });
      expect(thread()).toEqual([
        ['proposal-1', 'Refund of $4,000 issued on 2026-10-31 for purchase agreement A-TEST-0001.'],
      ]);
    });

    it('never exceed what was received', async () => {
      ledger = [
        paymentDoc(),
        paymentDoc({ _id: 'pay-r', kind: PaymentKind.Refund, amountCents: 700_000 }),
      ];
      expect(await h.call('POST', URL, refund)).toMatchObject({
        status: 422,
        body: { error: 'You can refund at most the $3,000 received' },
      });
    });

    it('need a signed, executed or cancelled agreement', async () => {
      agreement = signed({ status: AgreementStatus.UnderReview });
      expect((await h.call('POST', URL, refund)).status).toBe(409);
    });
  });

  describe('corrections', () => {
    it('link the new entry to the voided one it replaces', async () => {
      ledger = [paymentDoc({ status: PaymentStatus.Voided, voidReason: 'Wrong amount' })];
      const res = await h.call('POST', URL, { ...body, replacesId: 'pay-1' });
      expect(res.body).toMatchObject({ replacesId: 'pay-1' });
      expect(payments().findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'pay-1', replacedById: { $exists: false } },
        { $set: { replacedById: 'pay-new', updatedAt: NOW_ISO } },
      );
    });

    it('sales can resubmit a rejected entry', async () => {
      scene.principal = STAFF;
      ledger = [pending({ status: PaymentStatus.Rejected })];
      expect((await h.call('POST', URL, { ...body, replacesId: 'pay-p' })).status).toBe(201);
    });

    it('only replace a voided or rejected entry of the same kind', async () => {
      for (const old of [
        paymentDoc(),
        pending(),
        paymentDoc({ status: PaymentStatus.Voided, kind: PaymentKind.Refund }),
      ]) {
        ledger = [old];
        expect(
          await h.call('POST', URL, { ...body, replacesId: old._id }),
          old.status,
        ).toMatchObject({
          status: 422,
          body: {
            error: 'A correction can only replace a voided or rejected entry of the same kind',
          },
        });
      }
      ledger = [];
      expect((await h.call('POST', URL, { ...body, replacesId: 'nope' })).status).toBe(422);
      expect(payments().insertOne).not.toHaveBeenCalled();
    });

    it('an entry is corrected once', async () => {
      ledger = [paymentDoc({ status: PaymentStatus.Voided, replacedById: 'pay-0' })];
      expect(await h.call('POST', URL, { ...body, replacesId: 'pay-1' })).toMatchObject({
        status: 409,
        body: { error: 'This entry was already corrected' },
      });
      expect(payments().insertOne).not.toHaveBeenCalled();
    });

    it('frees the replaced entry again if the new one cannot be saved', async () => {
      ledger = [paymentDoc({ status: PaymentStatus.Voided })];
      payments().insertOne.mockRejectedValueOnce(new Error('disk full'));
      expect((await h.call('POST', URL, { ...body, replacesId: 'pay-1' })).status).toBe(500);
      expect(payments().updateOne).toHaveBeenCalledWith(
        { _id: 'pay-1', replacedById: 'pay-new' },
        { $unset: { replacedById: '' } },
      );
    });
  });
});

describe('PUT /agreements/:id/payments/:pid (edit a pending entry)', () => {
  beforeEach(() => {
    scene.principal = STAFF;
    ledger = [pending({ note: 'old note' })];
  });

  it('whoever recorded it fixes it while it waits; the edit is in its history', async () => {
    const res = await h.call('PUT', `${URL}/pay-p`, {
      amountCents: 700_000,
      receivedOn: '2026-10-29',
      method: PaymentMethod.BankDraft,
    });
    expect(res.status).toBe(200);
    expect(payments().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'pay-p', status: PaymentStatus.Pending, updatedAt: NOW_ISO },
      {
        $set: {
          amountCents: 700_000,
          receivedOn: '2026-10-29',
          method: PaymentMethod.BankDraft,
          history: [
            expect.objectContaining({ action: PaymentAction.Recorded }),
            { at: NOW_ISO, by: SALES_ACTOR, action: PaymentAction.Edited },
          ],
          updatedAt: NOW_ISO,
        },
        $unset: { externalRef: '', note: '' },
      },
    );
  });

  it('only whoever recorded it, and only while it waits', async () => {
    scene.principal = FINANCE;
    expect(await h.call('PUT', `${URL}/pay-p`, body)).toMatchObject({
      status: 403,
      body: { error: 'Only whoever recorded this entry can change or withdraw it' },
    });
    scene.principal = STAFF;
    ledger = [pending({ status: PaymentStatus.Posted })];
    expect(await h.call('PUT', `${URL}/pay-p`, body)).toMatchObject({
      status: 409,
      body: { error: 'This entry is no longer waiting for approval' },
    });
  });

  it('does not count itself against the price or as its own duplicate', async () => {
    ledger = [pending({ amountCents: 49_000_000, externalRef: 'W-77' })];
    const res = await h.call('PUT', `${URL}/pay-p`, { ...body, amountCents: 50_000_000 });
    expect(res.status).toBe(200);
    expect((await h.call('PUT', `${URL}/pay-p`, { ...body, amountCents: 50_000_001 })).status).toBe(
      422,
    );
  });

  it('is a conflict if it changed meanwhile, and a 404 on another agreement', async () => {
    payments().findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await h.call('PUT', `${URL}/pay-p`, body)).toMatchObject({
      status: 409,
      body: { error: 'This entry changed meanwhile; reload it' },
    });
    expect(await h.call('PUT', '/agreements/agr-1/payments/pay-elsewhere', body)).toMatchObject({
      status: 404,
      body: { error: 'Payment not found on this agreement' },
    });
  });
});

describe('approve, reject, withdraw', () => {
  beforeEach(() => {
    ledger = [pending()];
  });

  it('finance approves: it counts, the reviewer is on record, and the buyer is told', async () => {
    const res = await h.call('POST', `${URL}/pay-p/approve`);
    expect(res.status).toBe(200);
    expect(payments().findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'pay-p', status: PaymentStatus.Pending, updatedAt: NOW_ISO },
      {
        $set: {
          status: PaymentStatus.Posted,
          reviewedBy: FINANCE_ACTOR,
          reviewedAt: NOW_ISO,
          history: [
            expect.objectContaining({ action: PaymentAction.Recorded }),
            { at: NOW_ISO, by: FINANCE_ACTOR, action: PaymentAction.Approved },
          ],
          updatedAt: NOW_ISO,
        },
      },
    );
    expect(thread()).toEqual([
      [
        'proposal-1',
        'Payment of $10,000 received on 2026-10-30 for purchase agreement A-TEST-0001.',
      ],
    ]);
  });

  it('nobody approves an entry they recorded', async () => {
    ledger = [pending({ recordedBy: FINANCE_ACTOR })];
    expect(await h.call('POST', `${URL}/pay-p/approve`)).toMatchObject({
      status: 403,
      body: { error: 'Someone else must approve an entry you recorded' },
    });
  });

  it('only a pending entry can be approved, and not past the price', async () => {
    ledger = [pending({ status: PaymentStatus.Withdrawn })];
    expect((await h.call('POST', `${URL}/pay-p/approve`)).status).toBe(409);
    ledger = [pending(), paymentDoc({ amountCents: 49_500_000 })];
    expect(await h.call('POST', `${URL}/pay-p/approve`)).toMatchObject({
      status: 422,
      body: {
        error: 'This is more than the $5,000 left to pay',
      },
    });
  });

  it('two reviewers at once: the second gets a conflict', async () => {
    payments().findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await h.call('POST', `${URL}/pay-p/approve`)).status).toBe(409);
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('rejecting needs a reason, keeps it, and tells no one but the ledger', async () => {
    expect((await h.call('POST', `${URL}/pay-p/reject`, { reason: '' })).status).toBe(400);
    const res = await h.call('POST', `${URL}/pay-p/reject`, { reason: 'Cheque not received' });
    expect(res.status).toBe(200);
    expect(lastSet().$set).toMatchObject({
      status: PaymentStatus.Rejected,
      reviewedBy: FINANCE_ACTOR,
      rejectReason: 'Cheque not received',
      history: [
        expect.anything(),
        {
          at: NOW_ISO,
          by: FINANCE_ACTOR,
          action: PaymentAction.Rejected,
          reason: 'Cheque not received',
        },
      ],
    });
    expect(addMessage).not.toHaveBeenCalled();
    ledger = [pending({ status: PaymentStatus.Posted })];
    expect((await h.call('POST', `${URL}/pay-p/reject`, { reason: 'Too late' })).status).toBe(409);
  });

  it('whoever recorded it can withdraw it while it waits (a soft status, never a delete)', async () => {
    scene.principal = STAFF;
    expect((await h.call('POST', `${URL}/pay-p/withdraw`)).status).toBe(200);
    expect(lastSet().$set).toMatchObject({
      status: PaymentStatus.Withdrawn,
      history: [expect.anything(), expect.objectContaining({ action: PaymentAction.Withdrawn })],
    });
    expect(payments().deleteOne).not.toHaveBeenCalled();

    scene.principal = { ...STAFF, sub: 'staff-2' };
    expect((await h.call('POST', `${URL}/pay-p/withdraw`)).status).toBe(403);
    scene.principal = STAFF;
    ledger = [pending({ status: PaymentStatus.Posted })];
    expect((await h.call('POST', `${URL}/pay-p/withdraw`)).status).toBe(409);
  });
});

describe('POST /agreements/:id/payments/:pid/void', () => {
  it('voids a posted entry with a reason, keeping it and who voided it', async () => {
    ledger = [paymentDoc()];
    const res = await h.call('POST', `${URL}/pay-1/void`, { reason: 'NSF cheque' });
    expect(res.status).toBe(200);
    expect(lastSet().$set).toMatchObject({
      status: PaymentStatus.Voided,
      voidedBy: FINANCE_ACTOR,
      voidedAt: NOW_ISO,
      voidReason: 'NSF cheque',
    });
    expect(payments().deleteOne).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('needs a reason, and a posted entry', async () => {
    ledger = [paymentDoc()];
    expect((await h.call('POST', `${URL}/pay-1/void`, {})).status).toBe(400);
    ledger = [pending()];
    expect(await h.call('POST', `${URL}/pay-p/void`, { reason: 'Mistake' })).toMatchObject({
      status: 409,
      body: { error: 'Only a posted entry can be voided' },
    });
  });

  it('a payment whose money was refunded stays until the refund is voided', async () => {
    ledger = [
      paymentDoc(),
      paymentDoc({ _id: 'pay-r', kind: PaymentKind.Refund, amountCents: 400_000 }),
    ];
    expect(await h.call('POST', `${URL}/pay-1/void`, { reason: 'Mistake' })).toMatchObject({
      status: 409,
      body: { error: 'Refunds would exceed what was received; void the refund first' },
    });
    expect((await h.call('POST', `${URL}/pay-r/void`, { reason: 'Mistake' })).status).toBe(200);
  });
});

describe('GET /agreement-payments (the approval queue)', () => {
  it('finance and administrators see everyone’s entries waiting for approval, oldest first', async () => {
    for (const who of [FINANCE, ADMIN]) {
      scene.principal = who;
      ledger = [pending()];
      const res = await h.call('GET', '/agreement-payments');
      expect(res.body.map((p: { id: string }) => p.id)).toEqual(['pay-p']);
    }
    expect(payments().find).toHaveBeenCalledWith(
      { status: PaymentStatus.Pending },
      { sort: { recordedAt: 1 }, limit: 300 },
    );
  });

  it('filters by status and agreement', async () => {
    await h.call('GET', '/agreement-payments?status=voided&agreementId=agr-1');
    expect(payments().find).toHaveBeenCalledWith(
      { status: PaymentStatus.Voided, agreementId: 'agr-1' },
      expect.anything(),
    );
    expect((await h.call('GET', '/agreement-payments?status=lost')).status).toBe(400);
  });

  it('sales see only what they recorded', async () => {
    scene.principal = STAFF;
    await h.call('GET', '/agreement-payments');
    expect(payments().find).toHaveBeenCalledWith(
      { status: PaymentStatus.Pending, 'recordedBy.id': 'staff-1' },
      expect.anything(),
    );
  });
});

describe('GET /agreements/:id/payments/:pid/receipt', () => {
  it('the buyer keeps a PDF receipt of a payment received', async () => {
    ledger = [paymentDoc()];
    scene.principal = BUYER;
    const res = await h.call('GET', `${URL}/pay-1/receipt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="PAY-AAAA-0001-receipt.pdf"',
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(String(res.body).startsWith('%PDF')).toBe(true);
    expect(loadProposalFor).toHaveBeenCalledWith(expect.anything(), 'proposal-1');
  });

  it('only money that counts has a receipt', async () => {
    for (const status of [
      PaymentStatus.Pending,
      PaymentStatus.Rejected,
      PaymentStatus.Withdrawn,
      PaymentStatus.Voided,
    ]) {
      ledger = [paymentDoc({ status })];
      expect(await h.call('GET', `${URL}/pay-1/receipt`), status).toMatchObject({
        status: 404,
        body: { error: 'Only money received or refunded has a receipt' },
      });
    }
  });

  it('a signing link opens the agreement to sign it, not its receipts', async () => {
    ledger = [paymentDoc()];
    scene.principal = agreementSigner('agr-1', 'pur-1');
    expect((await h.call('GET', `${URL}/pay-1/receipt`)).status).toBe(403);
  });
});
