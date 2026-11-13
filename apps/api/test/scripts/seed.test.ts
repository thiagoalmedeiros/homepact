import {
  agreementTemplateInputSchema,
  AgreementStatus,
  CANADIAN_TAX_PRESETS,
  InventoryStatus,
  PaymentKind,
  PaymentStatus,
  ProposalStatus,
  Role,
  SignerStatus,
  type QuoteSnapshot,
} from '@homepact/shared';
import type { Db } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../src/auth/passwords.js';
import {
  companiesCollection,
  listTaxPresets,
  taxPresetsCollection,
} from '../../src/data/platform-repo.js';
import { tenantRepo } from '../../src/data/tenant-repo.js';
import { seedShowcase, seedSuperAdmin, showcaseSummary } from '../../src/scripts/seed.js';
import { SHOWCASE_COMPANY } from '../../src/scripts/showcase-data.js';

vi.mock('../../src/auth/passwords.js', () => ({ hashPassword: vi.fn() }));
vi.mock('../../src/data/platform-repo.js', () => ({
  companiesCollection: vi.fn(),
  listTaxPresets: vi.fn(),
  taxPresetsCollection: vi.fn(),
}));
vi.mock('../../src/data/tenant-repo.js', () => ({ tenantRepo: vi.fn() }));

type Doc = Record<string, unknown>;

/** Equality filters plus the few operators the seed uses. */
const matches = (doc: Doc, filter: Doc = {}) =>
  Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) {
      const value = doc[k];
      const wanted = (v as { $in: unknown[] }).$in;
      return Array.isArray(value) ? value.some((x) => wanted.includes(x)) : wanted.includes(value);
    }
    return doc[k] === v;
  });

const applyUpdate = (doc: Doc, update: { $set?: Doc; $unset?: Doc }) => {
  Object.assign(doc, update.$set ?? {});
  for (const k of Object.keys(update.$unset ?? {})) delete doc[k];
};

/** An in-memory stand-in for the data layer (tenant repos and the companies collection). */
const memoryDb = () => {
  const tables = new Map<string, Doc[]>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const collection = (name: string, scope: (d: Doc) => Doc, filterScope: Doc) => ({
    find: vi.fn(async (f?: Doc) => table(name).filter((d) => matches(d, { ...f, ...filterScope }))),
    findOne: vi.fn(
      async (f?: Doc) => table(name).find((d) => matches(d, { ...f, ...filterScope })) ?? null,
    ),
    insertOne: vi.fn(async (doc: Doc) => {
      const full = scope({ ...doc });
      table(name).push(full);
      return full;
    }),
    updateOne: vi.fn(async (f: Doc, u: { $set?: Doc; $unset?: Doc }) => {
      const doc = table(name).find((d) => matches(d, { ...f, ...filterScope }));
      if (doc) applyUpdate(doc, u);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    }),
    countDocuments: vi.fn(
      async (f?: Doc) => table(name).filter((d) => matches(d, { ...f, ...filterScope })).length,
    ),
  });
  vi.mocked(tenantRepo).mockImplementation(
    (_db, companyId) =>
      ({
        companyId,
        of: (name: string) => collection(name, (d) => ({ ...d, companyId }), { companyId }),
      }) as never,
  );
  vi.mocked(companiesCollection).mockImplementation(
    () => collection('companies', (d) => d, {}) as never,
  );
  vi.mocked(taxPresetsCollection).mockImplementation(
    () => collection('taxPresets', (d) => d, {}) as never,
  );
  vi.mocked(listTaxPresets).mockImplementation(async () => table('taxPresets') as never);
  return { db: {} as Db, table };
};

beforeEach(() => {
  vi.mocked(hashPassword).mockImplementation(async (pw) => `hashed(${pw})`);
});

describe('seedSuperAdmin', () => {
  it('creates a platform-level super_admin with a normalized email', async () => {
    const { db, table } = memoryDb();
    const user = await seedSuperAdmin(db, {
      email: ' Root@Platform.Test ',
      password: 'pw-12345678',
    });
    expect(tenantRepo).toHaveBeenCalledWith(db, null);
    expect(user).toMatchObject({
      email: 'root@platform.test',
      name: 'Platform Admin',
      role: Role.SuperAdmin,
      passwordHash: 'hashed(pw-12345678)',
      active: true,
      companyId: null,
    });
    expect(table('users')).toHaveLength(1);
  });

  it('is idempotent: an existing account gets its password reset and is re-activated', async () => {
    const { db, table } = memoryDb();
    await seedSuperAdmin(db, { email: 'root@platform.test', password: 'first-password' });
    table('users')[0]!['active'] = false;
    const again = await seedSuperAdmin(db, {
      email: 'root@platform.test',
      password: 'second-password',
    });
    expect(table('users')).toHaveLength(1);
    expect(table('users')[0]).toMatchObject({
      passwordHash: 'hashed(second-password)',
      active: true,
    });
    expect(again).toMatchObject({
      role: Role.SuperAdmin,
      active: true,
      passwordHash: 'hashed(second-password)',
    });
  });
});

describe('seedShowcase', () => {
  const opts = {
    showcaseOrigins: ['http://localhost:4200'],
    northwindOrigins: ['http://127.0.0.1:4200'],
    northwindLogoUrl: 'http://127.0.0.1:4200/demo/northwind-logo.svg',
    password: 'Showcase2026!',
    now: new Date('2026-10-31T12:00:00.000Z'),
  };

  it('seeds both tenants with consistent, priceable demo data', async () => {
    const { db, table } = memoryDb();
    const result = await seedShowcase(db, opts);

    expect(result.created).toBe(true);
    expect(result.invites?.length).toBeGreaterThan(0);
    for (const invite of result.invites ?? []) expect(invite.key).toMatch(/^[\w-]{43}$/);

    const companies = table('companies');
    expect(companies.map((c) => c['slug'])).toContain(SHOWCASE_COMPANY.slug);
    expect(companies).toHaveLength(2);
    const showcase = companies.find((c) => c['slug'] === SHOWCASE_COMPANY.slug)!;
    expect(showcase).toMatchObject({
      origins: opts.showcaseOrigins,
      currency: 'CAD',
      active: true,
    });
    expect(result.companyId).toBe(showcase['_id']);

    const ofShowcase = (name: string) =>
      table(name).filter((d) => d['companyId'] === showcase['_id']);
    expect(ofShowcase('users').map((u) => u['role'])).toEqual(
      expect.arrayContaining([Role.CompanyAdmin, Role.CompanyStaff, Role.Buyer]),
    );
    expect(ofShowcase('users').every((u) => u['passwordHash'] === 'hashed(Showcase2026!)')).toBe(
      true,
    );
    expect(ofShowcase('houses').length).toBeGreaterThan(0);
    expect(ofShowcase('inventoryHomes').length).toBeGreaterThan(0);

    const proposals = ofShowcase('proposals');
    expect(new Set(proposals.map((p) => p['status']))).toEqual(
      new Set([ProposalStatus.Proposed, ProposalStatus.ChangesRequested, ProposalStatus.Signed]),
    );
    for (const p of proposals) {
      const revs = ofShowcase('revisions').filter((r) => r['proposalId'] === p['_id']);
      const current = revs.find((r) => r['number'] === p['currentRevision']);
      expect(current, `proposal ${String(p['reference'])}`).toBeDefined();
      expect((current!['quote'] as { totalCents: number }).totalCents).toBe(p['currentTotalCents']);
    }

    expect(table('taxPresets').map((t) => t['code'])).toEqual(
      CANADIAN_TAX_PRESETS.map((t) => t.code),
    );
    const rates = ofShowcase('taxRates');
    expect(rates.map((r) => [r['code'], r['isDefault']])).toEqual([
      ['AB', true],
      ['BC', false],
    ]);
    const alberta = table('taxPresets').find((t) => t['code'] === 'AB')!;
    expect(rates[0]).toMatchObject({ presetId: alberta['_id'], components: alberta['components'] });
    for (const r of ofShowcase('revisions')) {
      const q = r['quote'] as QuoteSnapshot;
      expect(q.tax).toMatchObject({ regionCode: 'AB', lines: [{ label: 'GST', ratePercent: 5 }] });
      expect(q.totalCents).toBe(q.subtotalCents! + q.tax!.totalCents);
    }
    const [homeowner] = ofShowcase('referralPrograms');
    const referred = ofShowcase('revisions').filter((r) => (r['quote'] as QuoteSnapshot).referral);
    expect(referred).toHaveLength(1);
    expect((referred[0]!['quote'] as QuoteSnapshot).referral).toMatchObject({
      programId: homeowner!['_id'],
      referrerName: 'Dana Whitfield',
      creditCents: homeowner!['creditCents'],
    });
    expect(table('taxRates').every((r) => r['companyId'] === showcase['_id'])).toBe(true);
    const northwind = companies.find((c) => c['slug'] !== SHOWCASE_COMPANY.slug)!;
    for (const company of [showcase, northwind]) {
      const templates = table('agreementTemplates').filter(
        (t) => t['companyId'] === company['_id'],
      );
      expect(templates.length, String(company['slug'])).toBeGreaterThan(0);
      expect(templates.filter((t) => t['isDefault'])).toHaveLength(1);
      for (const t of templates) {
        expect(agreementTemplateInputSchema.safeParse(t).success).toBe(true);
        expect(t).toMatchObject({ version: 1, updatedByName: expect.any(String) });
      }
    }
    const names = (company: Doc) =>
      table('agreementTemplates')
        .filter((t) => t['companyId'] === company['_id'])
        .map((t) => t['name']);
    expect(names(northwind)).not.toEqual(expect.arrayContaining(names(showcase)));

    for (const k of ofShowcase('accessKeys')) {
      expect(k['hash']).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(k)).not.toContain(result.invites![0]!.key);
    }
  });

  it('someone from finance is on the team, with the same demo password', async () => {
    const { db, table } = memoryDb();
    await seedShowcase(db, opts);
    expect(table('users').filter((u) => u['role'] === Role.CompanyFinance)).toEqual([
      expect.objectContaining({
        email: 'riley@example-homes.demo',
        passwordHash: 'hashed(Showcase2026!)',
        active: true,
      }),
    ]);
  });

  it('finance has work waiting: a signed agreement, its deposit received, a payment to approve', async () => {
    const { db, table } = memoryDb();
    await seedShowcase(db, opts);
    const [agreement] = table('agreements');
    expect(agreement).toMatchObject({
      status: AgreementStatus.Signed,
      issuedAt: expect.any(String),
    });
    const purchasers = agreement!['purchasers'] as {
      status: SignerStatus;
      signature?: { contentHash: string };
    }[];
    for (const p of purchasers) {
      expect(p.status).toBe(SignerStatus.Signed);
      expect(p.signature?.contentHash).toBe(agreement!['contentHash']);
    }
    expect(table('proposals').find((p) => p['agreementId'] === agreement!['_id'])).toMatchObject({
      status: ProposalStatus.Signed,
    });

    const payments = table('agreementPayments').filter(
      (p) => p['agreementId'] === agreement!['_id'],
    );
    expect(
      payments.map((p) => [p['kind'], p['status'], (p['recordedBy'] as { role: Role }).role]),
    ).toEqual([
      [PaymentKind.Payment, PaymentStatus.Posted, Role.CompanyFinance],
      [PaymentKind.Payment, PaymentStatus.Pending, Role.CompanyStaff],
    ]);
    const deposit = (agreement!['terms'] as { depositCents: number }).depositCents;
    const recorded = payments.reduce((t, p) => t + (p['amountCents'] as number), 0);
    expect(recorded).toBeLessThanOrEqual(deposit);
  });

  it('the ready message gives every demo login, finance included', async () => {
    const { db } = memoryDb();
    const result = await seedShowcase(db, opts);
    const message = showcaseSummary(result, {
      showcaseOrigins: ['http://localhost:4200'],
      secondOrigin: 'http://127.0.0.1:4200',
      platformOrigin: 'http://localhost:4300',
      platformEmail: 'admin@platform.demo',
      password: 'Showcase2026!',
    });
    expect(message).toMatch(
      /Finance console +http:\/\/localhost:4200\/console\/payments +riley@example-homes\.demo \/ Showcase2026!/,
    );
    expect(message).toContain('jordan@example-homes.demo / Showcase2026!');
    expect(message).toContain('taylor@example.com / Showcase2026!');
  });

  it('a buyer account already owns an executed contract for a pre-existing home, with receipts', async () => {
    const { db, table } = memoryDb();
    await seedShowcase(db, opts);
    const buyer = table('users').find((u) => u['email'] === 'sam.rivera@example.com');
    expect(buyer).toMatchObject({ role: Role.Buyer, passwordHash: 'hashed(Showcase2026!)' });
    const proposal = table('proposals').find((p) => p['buyerUserId'] === buyer!['_id']);
    expect(proposal).toMatchObject({ kind: 'inventory', status: ProposalStatus.Signed });
    expect(
      table('inventoryHomes').find((h) => h['_id'] === proposal!['inventoryHomeId']),
    ).toMatchObject({ status: InventoryStatus.Sold });

    const agreement = table('agreements').find((a) => a['_id'] === proposal!['agreementId']);
    expect(agreement).toMatchObject({
      status: AgreementStatus.Executed,
      executedAt: expect.any(String),
      counterSignature: expect.objectContaining({ contentHash: agreement!['contentHash'] }),
    });
    const pdf = agreement!['executedPdf'] as { fileId: string };
    expect(table('agreementFiles').find((f) => f['_id'] === pdf.fileId)).toMatchObject({
      agreementId: agreement!['_id'],
      kind: 'executed',
    });

    const receipts = table('agreementPayments').filter(
      (p) => p['agreementId'] === agreement!['_id'],
    );
    expect(receipts.length).toBeGreaterThan(1);
    expect(receipts.every((p) => p['status'] === PaymentStatus.Posted)).toBe(true);
    const deposit = (agreement!['terms'] as { depositCents: number }).depositCents;
    expect(receipts.reduce((t, p) => t + (p['amountCents'] as number), 0)).toBe(deposit);
  });

  it('the ready message gives the login of the buyer who can see their receipts', async () => {
    const { db } = memoryDb();
    const result = await seedShowcase(db, opts);
    const message = showcaseSummary(result, {
      showcaseOrigins: ['http://localhost:4200'],
      secondOrigin: 'http://127.0.0.1:4200',
      platformOrigin: 'http://localhost:4300',
      platformEmail: 'admin@platform.demo',
      password: 'Showcase2026!',
    });
    expect(message).toContain('sam.rivera@example.com / Showcase2026!');
  });

  it('is idempotent: a second run only refreshes the origins', async () => {
    const { db, table } = memoryDb();
    await seedShowcase(db, opts);
    const before = table('proposals').length;
    const again = await seedShowcase(db, { ...opts, showcaseOrigins: ['http://demo.test'] });
    expect(again).toEqual({ created: false, companyId: expect.any(String) });
    expect(table('proposals')).toHaveLength(before);
    expect(table('taxPresets')).toHaveLength(CANADIAN_TAX_PRESETS.length);
    expect(table('companies').find((c) => c['slug'] === SHOWCASE_COMPANY.slug)).toMatchObject({
      origins: ['http://demo.test'],
    });
  });

  it('refuses to take over an origin another company owns', async () => {
    const { db, table } = memoryDb();
    table('companies').push({
      _id: 'other',
      name: 'Someone Else',
      slug: 'other',
      origins: opts.showcaseOrigins,
    });
    await expect(seedShowcase(db, opts)).rejects.toThrow(
      'Origin already belongs to "Someone Else"',
    );
  });
});
