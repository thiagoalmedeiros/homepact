import {
  agreementState,
  AmendmentStatus,
  ApprovalReason,
  DEFAULT_AMENDMENT_POLICY,
} from '@homepact/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDatabase } from '../../../src/data/memory-db.js';
import { tenantRepo, type TenantRepo } from '../../../src/data/tenant-repo.js';
import {
  amendmentsOf,
  claimAgreement,
  loadPolicy,
  openAmendmentOf,
  releaseAgreement,
  savePolicy,
  stateOf,
  statesOf,
  toAmendment,
  toAmendmentSummary,
  type AmendmentDoc,
} from '../../../src/modules/amendments/store.js';
import { agreementDoc, amendmentDoc, quote, TERMS } from '../../support/fixtures.js';
import { COMPANY_ID, NOW, NOW_ISO } from '../../support/mocks.js';

const executed = (number: number, totalCents: number, over: Partial<AmendmentDoc> = {}) =>
  amendmentDoc({
    _id: `amd-${number}`,
    number,
    reference: `CO-TEST-000${number}`,
    status: AmendmentStatus.Executed,
    contentHash: String(number).repeat(64),
    executedAt: `2026-11-0${number}T10:00:00.000Z`,
    after: {
      selections: {},
      quote: quote({ subtotalCents: totalCents, totalCents }),
      terms: TERMS,
    },
    ...over,
  });

let repo: TenantRepo;
let other: TenantRepo;
const insert = (...docs: AmendmentDoc[]) =>
  Promise.all(docs.map(({ companyId: _c, ...d }) => amendmentsOf(repo).insertOne(d)));

beforeEach(() => {
  const { db } = createMemoryDatabase();
  repo = tenantRepo(db, COMPANY_ID);
  other = tenantRepo(db, 'company-b');
});

describe('toAmendment', () => {
  it('exposes _id as id, never the company or where the PDF is stored', () => {
    const out = toAmendment(
      amendmentDoc({ executedPdf: { fileId: 'file-1', sha256: 'abc', size: 42 } }),
    );
    expect(out).toMatchObject({ id: 'amd-1', reference: 'CO-TEST-0001', number: 1 });
    expect(out.executedPdf).toEqual({ sha256: 'abc', size: 42 });
    expect(out).not.toHaveProperty('_id');
    expect(out).not.toHaveProperty('companyId');
    expect(toAmendment(amendmentDoc())).not.toHaveProperty('executedPdf');
    expect(toAmendment(amendmentDoc(), 'pur-1').viewerPurchaserId).toBe('pur-1');
  });

  it('sums one up for lists', () => {
    expect(
      toAmendmentSummary(
        amendmentDoc({ approval: { required: true, reasons: [ApprovalReason.Credit] } }),
      ),
    ).toEqual({
      id: 'amd-1',
      reference: 'CO-TEST-0001',
      number: 1,
      agreementId: 'agr-1',
      agreementReference: 'A-TEST-0001',
      status: AmendmentStatus.Priced,
      changeCount: 1,
      beforeTotalCents: 50_000_000,
      afterTotalCents: 50_800_000,
      currency: 'CAD',
      approvalReasons: [ApprovalReason.Credit],
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    const requested = amendmentDoc({ status: AmendmentStatus.Requested });
    delete requested.after;
    delete requested.approval;
    expect(toAmendmentSummary(requested)).not.toHaveProperty('afterTotalCents');
    expect(toAmendmentSummary(requested).approvalReasons).toEqual([]);
  });
});

describe('stateOf and statesOf', () => {
  it('is the agreement as signed until an amendment is executed', async () => {
    await insert(amendmentDoc({ _id: 'open', status: AmendmentStatus.Priced }));
    expect(await stateOf(repo, agreementDoc())).toEqual(agreementState(agreementDoc()));
  });

  it('folds in the executed amendments of this agreement and company only', async () => {
    await insert(
      executed(2, 51_200_000),
      executed(1, 50_900_000),
      amendmentDoc({ _id: 'rejected', number: 3, status: AmendmentStatus.Rejected }),
      executed(1, 99_000_000, { _id: 'elsewhere', agreementId: 'agr-2' }),
    );
    const { companyId: _c, ...foreign } = executed(3, 1, { _id: 'foreign' });
    await amendmentsOf(other).insertOne(foreign);

    const state = await stateOf(repo, agreementDoc());
    expect(state.totalCents).toBe(51_200_000);
    expect(state.amendments.map((a) => a.number)).toEqual([1, 2]);

    const states = await statesOf(repo, [agreementDoc(), agreementDoc({ _id: 'agr-2' })]);
    expect(states.get('agr-1')?.totalCents).toBe(51_200_000);
    expect(states.get('agr-2')?.totalCents).toBe(99_000_000);
    expect((await statesOf(repo, [])).size).toBe(0);
  });
});

describe('claimAgreement and releaseAgreement', () => {
  it('lets one amendment at a time hold an agreement', async () => {
    expect(await openAmendmentOf(repo, 'agr-1')).toBeUndefined();
    expect(await claimAgreement(repo, 'agr-1', 'amd-1', NOW)).toBe(true);
    expect(await claimAgreement(repo, 'agr-1', 'amd-2', NOW)).toBe(false);
    expect(await openAmendmentOf(repo, 'agr-1')).toBe('amd-1');
    expect(await claimAgreement(repo, 'agr-2', 'amd-3', NOW)).toBe(true);

    await releaseAgreement(repo, 'agr-1', 'amd-2', NOW);
    expect(await openAmendmentOf(repo, 'agr-1')).toBe('amd-1');
    await releaseAgreement(repo, 'agr-1', 'amd-1', NOW);
    expect(await openAmendmentOf(repo, 'agr-1')).toBeUndefined();
    expect(await claimAgreement(repo, 'agr-1', 'amd-2', NOW)).toBe(true);
  });

  it('gives the agreement to only one of two amendments claiming it at the same moment', async () => {
    const claims = await Promise.all([
      claimAgreement(repo, 'agr-1', 'amd-1', NOW),
      claimAgreement(repo, 'agr-1', 'amd-2', NOW),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await openAmendmentOf(repo, 'agr-1')).toBe(claims[0] ? 'amd-1' : 'amd-2');
  });

  it('keeps each company’s agreements apart', async () => {
    expect(await claimAgreement(repo, 'agr-1', 'amd-1', NOW)).toBe(true);
    expect(await openAmendmentOf(other, 'agr-1')).toBeUndefined();
  });
});

describe('policy', () => {
  it('defaults to approving credits and adjustments until an administrator sets it', async () => {
    expect(await loadPolicy(repo)).toEqual(DEFAULT_AMENDMENT_POLICY);
    const saved = { approveCredits: false, approveAdjustments: true, approveAboveCents: 500_000 };
    expect(await savePolicy(repo, saved, 'Alex Admin', NOW)).toEqual(saved);
    expect(await loadPolicy(repo)).toEqual(saved);
    expect(await savePolicy(repo, DEFAULT_AMENDMENT_POLICY, 'Alex Admin', NOW)).toEqual(
      DEFAULT_AMENDMENT_POLICY,
    );
    expect(await loadPolicy(other)).toEqual(DEFAULT_AMENDMENT_POLICY);
  });
});
