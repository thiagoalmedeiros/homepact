import {
  AccessResourceType,
  agreementTemplateInputSchema,
  AgreementStatus,
  applyChanges,
  ChangeDecision,
  ChangeRequestStatus,
  computeQuote,
  formatMoney,
  HouseStatus,
  InventoryStatus,
  keyClauses,
  Party,
  PaymentAction,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  priceBeforeTax,
  ProposalStatus,
  Role,
  SignerStatus,
  type Adjustment,
  type AgreementTemplateInput,
  type Catalog,
  type Change,
  type CompanyRole,
  type Currency,
  type PriceOverride,
  type QuoteExtras,
  type QuoteReferral,
  type SalesTaxRate,
  type Selections,
} from '@homepact/shared';
import type { Db } from 'mongodb';
import { hashPassword } from '../auth/passwords.js';
import { newId, reference, sha256 } from '../data/ids.js';
import { companiesCollection, listTaxPresets, type CompanyDoc } from '../data/platform-repo.js';
import { tenantRepo, type TenantRepo } from '../data/tenant-repo.js';
import { createAccessKey } from '../modules/access-keys/keys.js';
import type { AgreementTemplateDoc } from '../modules/agreement-templates/store.js';
import { composeAgreement } from '../modules/agreements/document.js';
import { withIds } from '../modules/agreements/purchasers.js';
import { builtInSignatureProvider } from '../modules/agreements/signature-provider.js';
import { renderAgreementPdf } from '../modules/agreements/pdf.js';
import {
  toAgreement,
  type AgreementDoc,
  type AgreementFileDoc,
} from '../modules/agreements/store.js';
import type { UserDoc } from '../modules/auth/users.js';
import {
  loadCatalog,
  type AreaDoc,
  type CatalogItemDoc,
  type PackageDoc,
} from '../modules/catalog/store.js';
import type { HouseDoc } from '../modules/houses/store.js';
import { ASKING_PRICE_LABEL } from '../modules/houses/pricing.js';
import type { InventoryHomeDoc } from '../modules/inventory/store.js';
import type { PaymentDoc } from '../modules/payments/store.js';
import type { ReferralProgramDoc } from '../modules/referrals/store.js';
import type { TaxRateDoc } from '../modules/sales-tax/store.js';
import { addStarterPresets } from '../modules/tax-presets/routes.js';
import {
  describeChange,
  packageContents,
  type ChangeRequestDoc,
  type MessageDoc,
  type ProposalDoc,
  type RevisionDoc,
} from '../modules/proposals/store.js';
import {
  AGREEMENT_TEMPLATES,
  AREAS,
  HOUSES,
  INVENTORY,
  ITEMS,
  NORTHWIND,
  NORTHWIND_DATA,
  PACKAGES,
  REFERRAL_PROGRAMS,
  SEED_TEXT,
  SHOWCASE_COMPANY,
  SHOWCASE_TAX_REGIONS,
  STORY,
  type SeedHouse,
} from './showcase-data.js';
import { NAMES, THREAD } from '../messages.js';

const cents = (dollars: number) => Math.round(dollars * 100);

/** Creates (or resets the password of) the platform super-admin. Idempotent. */
export const seedSuperAdmin = async (
  db: Db,
  {
    email,
    password,
    name = SEED_TEXT.superAdminName as string,
  }: { email: string; password: string; name?: string },
): Promise<UserDoc> => {
  const users = tenantRepo(db, null).of<UserDoc>('users');
  const normalized = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const existing = await users.findOne({ email: normalized });
  if (existing) {
    await users.updateOne(
      { _id: existing._id },
      { $set: { passwordHash, role: Role.SuperAdmin, active: true } },
    );
    return { ...existing, passwordHash, role: Role.SuperAdmin, active: true };
  }
  return users.insertOne({
    _id: newId(),
    email: normalized,
    name,
    role: Role.SuperAdmin,
    passwordHash,
    active: true,
    createdAt: new Date().toISOString(),
  });
};

const upsertCompany = async (
  db: Db,
  doc: Omit<CompanyDoc, '_id' | 'createdAt' | 'updatedAt'>,
): Promise<{ company: CompanyDoc; created: boolean }> => {
  const companies = companiesCollection(db);
  const existing = await companies.findOne({ slug: doc.slug });
  const ts = new Date().toISOString();
  if (existing) {
    await companies.updateOne(
      { _id: existing._id },
      { $set: { origins: doc.origins, active: true, updatedAt: ts } },
    );
    return { company: { ...existing, origins: doc.origins }, created: false };
  }
  const owner = await companies.findOne({ origins: { $in: doc.origins } });
  if (owner) {
    throw new Error(SEED_TEXT.originTaken(owner.name));
  }
  const company: CompanyDoc = { _id: newId(), ...doc, createdAt: ts, updatedAt: ts };
  await companies.insertOne(company);
  return { company, created: true };
};

const addUser = async (
  repo: TenantRepo,
  u: { name: string; email: string; role: UserDoc['role']; phone?: string },
  password: string,
) =>
  repo.of<UserDoc>('users').insertOne({
    _id: newId(),
    email: u.email,
    name: u.name,
    role: u.role,
    passwordHash: await hashPassword(password),
    active: true,
    createdAt: new Date().toISOString(),
    ...(u.phone && { phone: u.phone }),
  });

const seedCatalog = async (repo: TenantRepo) => {
  const itemIds = new Map<string, string>();
  const packageIds = new Map<string, string>();
  for (const a of AREAS) await repo.of<AreaDoc>('areas').insertOne({ _id: newId(), ...a });
  for (const i of ITEMS) {
    const id = newId();
    itemIds.set(i.key, id);
    await repo.of<CatalogItemDoc>('catalogItems').insertOne({
      _id: id,
      areaSlug: i.area,
      name: i.name,
      priceCents: cents(i.price),
      soldSeparately: !PACKAGE_ONLY_AREAS.has(i.area),
      ...(i.description && { description: i.description }),
      ...(i.imageUrl && { imageUrl: i.imageUrl }),
    });
  }
  for (const p of PACKAGES) {
    const id = newId();
    packageIds.set(p.key, id);
    await repo.of<PackageDoc>('packages').insertOne({
      _id: id,
      areaSlug: p.area,
      name: p.name,
      description: p.description,
      itemIds: p.items.map((k) => itemIds.get(k)!),
      priceCents: cents(p.price),
      ...(p.imageUrl && { imageUrl: p.imageUrl }),
    });
  }
  return { itemIds, packageIds };
};

/** Agreement templates go through the API's own validation: a bad merge field fails the seed. */
const seedTemplates = async (
  repo: TenantRepo,
  templates: AgreementTemplateInput[],
  authorName: string,
  at: Date,
) => {
  for (const t of templates) {
    await repo.of<AgreementTemplateDoc>('agreementTemplates').insertOne({
      _id: newId(),
      ...agreementTemplateInputSchema.parse(t),
      version: 1,
      updatedByName: authorName,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    });
  }
};

/** Adopts the platform suggestions the showcase sells in, and returns its default province. */
const seedTaxRates = async (
  db: Db,
  repo: TenantRepo,
  regions: { adopt: readonly string[]; default: string },
  at: Date,
): Promise<SalesTaxRate> => {
  const presets = await listTaxPresets(db);
  let fallback: SalesTaxRate | undefined;
  for (const code of regions.adopt) {
    const preset = presets.find((p) => p.code === code);
    if (!preset) throw new Error(SEED_TEXT.missingTaxPreset(code));
    const rate = { code: preset.code, name: preset.name, components: preset.components };
    await repo.of<TaxRateDoc>('taxRates').insertOne({
      _id: newId(),
      ...rate,
      isDefault: code === regions.default,
      presetId: preset._id,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    });
    if (code === regions.default) fallback = rate;
  }
  return fallback!;
};

const seedReferralPrograms = async (repo: TenantRepo, at: Date) => {
  const programs: ReferralProgramDoc[] = [];
  for (const p of REFERRAL_PROGRAMS) {
    programs.push(
      await repo.of<ReferralProgramDoc>('referralPrograms').insertOne({
        _id: newId(),
        ...p,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      }),
    );
  }
  return programs;
};

const PACKAGE_ONLY_AREAS = new Set(['elevation']);

/** Bigger plans charge more for the same options, as per-plan price overrides. */
const overridesFor = (
  h: SeedHouse,
  ids: Awaited<ReturnType<typeof seedCatalog>>,
): PriceOverride[] => {
  const scale = h.scale ?? 1;
  if (scale === 1) return [];
  const scaled = (price: number) => Math.round((price * scale) / 10) * 1000;
  return [
    ...PACKAGES.filter((p) => p.price > 0).map((p) => ({
      refId: ids.packageIds.get(p.key)!,
      priceCents: scaled(p.price),
    })),
    ...ITEMS.filter((i) => i.price > 0 && !PACKAGE_ONLY_AREAS.has(i.area)).map((i) => ({
      refId: ids.itemIds.get(i.key)!,
      priceCents: scaled(i.price),
    })),
  ];
};

const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);

export interface ShowcaseOptions {
  showcaseOrigins: string[];
  northwindOrigins: string[];
  northwindLogoUrl: string;
  password: string;
  now?: Date;
}

export interface ShowcaseResult {
  created: boolean;
  companyId: string;
  invites?: { label: string; key: string }[];
}

interface Ctx {
  repo: TenantRepo;
  catalog: Catalog;
  currency: Currency;
  tax: SalesTaxRate;
  houses: Map<string, HouseDoc>;
  ids: Awaited<ReturnType<typeof seedCatalog>>;
}

/** Seeds Example Homes (catalog, plans, homes, team with finance, sales tax, referral programs,
 * proposals in every state, a signed and an executed agreement with payments) and a second
 * tenant. Idempotent. */
export const seedShowcase = async (db: Db, opts: ShowcaseOptions): Promise<ShowcaseResult> => {
  const now = opts.now ?? new Date();
  const currency: Currency = 'CAD';
  await addStarterPresets(db, now);
  const { company, created } = await upsertCompany(db, {
    name: SHOWCASE_COMPANY.name,
    slug: SHOWCASE_COMPANY.slug,
    logoUrl: `${opts.showcaseOrigins[0]}${SHOWCASE_COMPANY.logoPath}`,
    origins: opts.showcaseOrigins,
    currency,
    active: true,
    tagline: SHOWCASE_COMPANY.tagline,
    contact: SHOWCASE_COMPANY.contact,
  });
  await seedNorthwind(db, opts);
  if (!created) return { created: false, companyId: company._id };

  const repo = tenantRepo(db, company._id);
  const team = [];
  for (const m of SHOWCASE_COMPANY.team) team.push(await addUser(repo, m, opts.password));
  const [morgan, jordan, casey, riley] = team as [UserDoc, UserDoc, UserDoc, UserDoc];
  const buyer = await addUser(repo, { ...SHOWCASE_COMPANY.buyer, role: Role.Buyer }, opts.password);

  const ids = await seedCatalog(repo);
  await seedTemplates(repo, AGREEMENT_TEMPLATES.showcase, morgan.name, now);
  const tax = await seedTaxRates(db, repo, SHOWCASE_TAX_REGIONS, now);
  const [homeownerReferral] = await seedReferralPrograms(repo, now);
  const houses = new Map<string, HouseDoc>();
  for (const h of HOUSES) {
    const ts = now.toISOString();
    const doc = await repo.of<HouseDoc>('houses').insertOne({
      _id: newId(),
      name: h.name,
      slug: h.slug,
      style: h.style,
      headline: h.headline,
      description: h.description,
      communities: h.communities,
      specs: { sqft: h.sqft, beds: h.beds, baths: h.baths, garage: h.garage, storeys: h.storeys },
      images: h.images,
      floorPlanImages: h.floorPlans,
      basePriceCents: cents(h.price),
      priceOverrides: overridesFor(h, ids),
      status: h.published ? HouseStatus.Published : HouseStatus.Draft,
      createdAt: ts,
      updatedAt: ts,
    });
    houses.set(h.slug, doc);
  }
  const c: Ctx = { repo, catalog: await loadCatalog(repo), currency, tax, houses, ids };

  const inventory = new Map<string, InventoryHomeDoc>();
  for (const home of INVENTORY) {
    const house = houses.get(home.model)!;
    const ts = now.toISOString();
    const doc = await repo.of<InventoryHomeDoc>('inventoryHomes').insertOne({
      _id: newId(),
      houseId: house._id,
      address: home.address,
      community: home.community,
      possession: home.possession,
      selections: sel(c, home.selections),
      priceCents: cents(home.price),
      features: home.features,
      images: [],
      lockedByDefault: home.locked,
      status: InventoryStatus.Available,
      createdAt: ts,
      updatedAt: ts,
    });
    inventory.set(home.address, doc);
  }

  const invites: { label: string; key: string }[] = [];
  const day = 24 * 60;

  {
    const t0 = at(now, -3 * day);
    const p = await propose(c, {
      house: 'alder',
      selections: {
        elevation: ['pkg', 'farmhouse'],
        interior: ['pkg', 'signature'],
        'main-floor': ['items', 'spice-kitchen'],
        'upper-floor': ['items', 'fourth-bed'],
        basement: ['pkg', 'income-ready'],
      },
      buyer: { name: buyer.name, email: buyer.email, phone: SHOWCASE_COMPANY.buyer.phone },
      buyerUserId: buyer._id,
      rep: jordan,
      at: t0,
      note: STORY.taylor.welcome,
    });
    await say(c, p, Party.Buyer, buyer.name, STORY.taylor.reply, at(t0, 60 * 20));
    await requestChanges(
      c,
      p,
      buyer.name,
      [
        {
          type: 'remove_item',
          areaSlug: 'main-floor',
          itemId: c.ids.itemIds.get('spice-kitchen')!,
        },
        { type: 'set_package', areaSlug: 'interior', packageId: c.ids.packageIds.get('designer')! },
      ],
      at(t0, 60 * 20 + 1),
    );
  }

  {
    const p = await propose(c, {
      house: 'spruce',
      selections: {
        elevation: ['pkg', 'mountain'],
        interior: ['pkg', 'designer'],
        'main-floor': ['items', 'exec-kitchen', 'open-below'],
        energy: ['items', 'solar', 'ev'],
      },
      adjustments: [{ label: STORY.patel.lotPremium, amountCents: cents(35_000) }],
      referral: {
        programId: homeownerReferral!._id,
        programName: homeownerReferral!.name,
        ...STORY.patel.referrer,
        creditCents: homeownerReferral!.creditCents,
      },
      buyer: { ...STORY.patel.buyer },
      rep: jordan,
      at: at(now, -day),
      note: STORY.patel.note,
    });
    invites.push({ label: STORY.patel.invite, key: p.key });
  }

  {
    const p = await propose(c, {
      inventory: inventory.get('140 Sample Common SE')!,
      buyer: { ...STORY.alex.buyer },
      rep: casey,
      at: at(now, -5 * 60),
      note: STORY.alex.note,
    });
    invites.push({ label: STORY.alex.invite, key: p.key });
  }

  {
    const t0 = at(now, -12 * day);
    const home = inventory.get('455 Example Manor SE')!;
    const p = await propose(c, {
      inventory: home,
      buyer: { ...STORY.jamie.buyer },
      rep: casey,
      at: t0,
    });
    const cr = await requestChanges(
      c,
      p,
      STORY.jamie.buyer.name,
      [
        {
          type: 'set_package',
          areaSlug: 'interior',
          packageId: c.ids.packageIds.get('signature')!,
        },
        { type: 'add_item', areaSlug: 'energy', itemId: c.ids.itemIds.get('solar')! },
      ],
      at(t0, 60 * 30),
    );
    await decide(c, p, cr, casey, [true, false], at(t0, 60 * 50), STORY.jamie.answer);
    await sign(c, p, STORY.jamie.buyer.name, at(t0, 60 * 24 * 2));
  }

  {
    const t0 = at(now, -20 * day);
    const p = await propose(c, {
      house: 'maple',
      selections: { elevation: ['pkg', 'mountain'], interior: ['pkg', 'signature'] },
      buyer: { ...STORY.lee.buyer },
      rep: jordan,
      at: t0,
    });
    await sign(c, p, STORY.lee.buyer.name, at(t0, day));
    const agreement = await seedAgreement(c, company, p, {
      rep: jordan,
      when: at(t0, 3 * day),
      purchasers: STORY.lee.purchasers,
      deposits: [
        { label: STORY.lee.deposits.onSigning, dollars: 10_000 },
        { label: STORY.lee.deposits.second, dollars: 20_000, dueInDays: 30 },
      ],
      closingInDays: 120,
    });
    await recordPayment(c, p, agreement, riley, {
      status: PaymentStatus.Posted,
      amountCents: agreement.terms.deposits[0]!.amountCents,
      receivedOn: at(t0, 3 * day),
      method: PaymentMethod.Cheque,
      externalRef: STORY.lee.cheque,
    });
    await recordPayment(c, p, agreement, jordan, {
      status: PaymentStatus.Pending,
      amountCents: agreement.terms.deposits[1]!.amountCents,
      receivedOn: at(now, -day),
      method: PaymentMethod.Wire,
      externalRef: STORY.lee.wire,
      note: STORY.lee.note,
    });
  }

  {
    const t0 = at(now, -60 * day);
    const sam = await addUser(repo, { ...STORY.rivera.buyer, role: Role.Buyer }, opts.password);
    const p = await propose(c, {
      inventory: inventory.get(STORY.rivera.home)!,
      buyer: { ...STORY.rivera.buyer },
      buyerUserId: sam._id,
      rep: casey,
      at: t0,
    });
    await sign(c, p, sam.name, at(t0, day));
    const agreement = await seedAgreement(c, company, p, {
      rep: casey,
      when: at(t0, 3 * day),
      purchasers: [{ name: sam.name, email: sam.email }],
      deposits: [
        { label: STORY.rivera.deposits.onSigning, dollars: 15_000 },
        { label: STORY.rivera.deposits.second, dollars: 25_000, dueInDays: 30 },
      ],
      closingInDays: 90,
      countersignedBy: morgan,
    });
    await recordPayment(c, p, agreement, riley, {
      status: PaymentStatus.Posted,
      amountCents: agreement.terms.deposits[0]!.amountCents,
      receivedOn: at(t0, 3 * day),
      method: PaymentMethod.Cheque,
      externalRef: STORY.rivera.cheque,
    });
    await recordPayment(c, p, agreement, casey, {
      status: PaymentStatus.Posted,
      amountCents: agreement.terms.deposits[1]!.amountCents,
      receivedOn: at(t0, 30 * day),
      method: PaymentMethod.Wire,
      externalRef: STORY.rivera.wire,
      approvedBy: riley,
    });
  }

  return { created: true, companyId: company._id, invites };
};

type SelSpec = Record<string, ['pkg', string] | ['items', ...string[]]>;

const sel = (c: Ctx, spec: SelSpec): Selections =>
  Object.fromEntries(
    Object.entries(spec).map(([area, [kind, ...keys]]) => [
      area,
      kind === 'pkg'
        ? { packageId: c.ids.packageIds.get(keys[0]!)! }
        : { itemIds: keys.map((k) => c.ids.itemIds.get(k)!) },
    ]),
  );

const priced = (
  c: Ctx,
  house: HouseDoc,
  selections: Selections,
  adjustments: Adjustment[] = [],
  extras: QuoteExtras = {},
) =>
  computeQuote({ ...house, id: house._id }, c.catalog, selections, c.currency, adjustments, extras);

interface Seeded {
  doc: ProposalDoc;
  key: string;
}

const propose = async (
  c: Ctx,
  o: {
    house?: string;
    selections?: SelSpec;
    inventory?: InventoryHomeDoc;
    adjustments?: Adjustment[];
    referral?: QuoteReferral;
    buyer: ProposalDoc['buyer'];
    buyerUserId?: string;
    rep: UserDoc;
    at: Date;
    note?: string;
  },
): Promise<Seeded> => {
  const house = o.inventory
    ? [...c.houses.values()].find((h) => h._id === o.inventory!.houseId)!
    : c.houses.get(o.house!)!;
  const selections = o.inventory ? o.inventory.selections : sel(c, o.selections!);
  let adjustments = o.adjustments ?? [];
  if (o.inventory?.priceCents !== undefined) {
    const configured = priced(c, house, selections);
    adjustments = [
      { label: ASKING_PRICE_LABEL, amountCents: o.inventory.priceCents - configured.totalCents },
      ...adjustments,
    ];
  }
  const quote = priced(c, house, selections, adjustments, {
    tax: c.tax,
    referral: o.referral ?? null,
  });
  const id = newId();
  const ts = o.at.toISOString();
  const { key, doc: keyDoc } = await createAccessKey(c.repo, AccessResourceType.Proposal, id, {
    createdBy: o.rep._id,
    now: o.at,
  });
  const imageUrl = house.images[0];
  const doc = await c.repo.of<ProposalDoc>('proposals').insertOne({
    _id: id,
    reference: reference('P'),
    kind: o.inventory ? 'inventory' : 'plan',
    houseId: house._id,
    houseName: house.name,
    ...(imageUrl && { imageUrl }),
    ...(o.inventory && {
      inventoryHomeId: o.inventory._id,
      address: o.inventory.address,
      community: o.inventory.community,
    }),
    locked: o.inventory?.lockedByDefault ?? false,
    buyer: o.buyer,
    ...(o.buyerUserId && { buyerUserId: o.buyerUserId }),
    repId: o.rep._id,
    repName: o.rep.name,
    status: ProposalStatus.Proposed,
    currentRevision: 1,
    currentTotalCents: quote.totalCents,
    currency: quote.currency,
    accessKeyId: keyDoc._id,
    lastActivityAt: ts,
    createdAt: ts,
    updatedAt: ts,
  });
  await c.repo.of<RevisionDoc>('revisions').insertOne({
    _id: newId(),
    proposalId: id,
    number: 1,
    selections,
    quote,
    authorName: o.rep.name,
    createdAt: ts,
    ...(o.note && { note: o.note }),
  });
  await say(
    c,
    { doc, key },
    Party.System,
    NAMES.system,
    THREAD.proposed(
      o.rep.name,
      house.name,
      o.inventory?.address,
      formatMoney(quote.totalCents, quote.currency),
    ),
    o.at,
  );
  if (o.note) await say(c, { doc, key }, Party.Seller, o.rep.name, o.note, o.at);
  return { doc, key };
};

const say = async (
  c: Ctx,
  p: Seeded,
  party: MessageDoc['party'],
  authorName: string,
  body: string,
  when: Date,
) => {
  await c.repo.of<MessageDoc>('proposalMessages').insertOne({
    _id: newId(),
    proposalId: p.doc._id,
    party,
    authorName,
    body,
    createdAt: when.toISOString(),
  });
  await c.repo
    .of<ProposalDoc>('proposals')
    .updateOne({ _id: p.doc._id }, { $set: { lastActivityAt: when.toISOString() } });
};

const revisionOf = async (c: Ctx, p: Seeded) => {
  const doc = (await c.repo.of<ProposalDoc>('proposals').findOne({ _id: p.doc._id }))!;
  const rev = (await c.repo
    .of<RevisionDoc>('revisions')
    .findOne({ proposalId: doc._id, number: doc.currentRevision }))!;
  return { doc, rev, house: [...c.houses.values()].find((h) => h._id === doc.houseId)! };
};

const requestChanges = async (
  c: Ctx,
  p: Seeded,
  author: string,
  changes: Change[],
  when: Date,
): Promise<ChangeRequestDoc> => {
  const { doc, rev, house } = await revisionOf(c, p);
  const extras = { tax: c.tax, referral: rev.quote.referral ?? null };
  const all = priced(
    c,
    house,
    applyChanges(rev.selections, changes, packageContents(c.catalog)),
    rev.quote.adjustments,
    extras,
  );
  const crId = newId();
  const cr = await c.repo.of<ChangeRequestDoc>('changeRequests').insertOne({
    _id: crId,
    proposalId: doc._id,
    baseRevision: doc.currentRevision,
    changes: changes.map((change) => ({
      id: newId(),
      change,
      label: describeChange(change, rev.selections, c.catalog),
      deltaCents:
        priceBeforeTax(
          priced(
            c,
            house,
            applyChanges(rev.selections, [change], packageContents(c.catalog)),
            rev.quote.adjustments,
            extras,
          ),
        ) - priceBeforeTax(rev.quote),
    })),
    previewTotalCents: all.totalCents,
    status: ChangeRequestStatus.Open,
    authorName: author,
    createdAt: when.toISOString(),
  });
  await c.repo
    .of<ProposalDoc>('proposals')
    .updateOne(
      { _id: doc._id },
      { $set: { status: ProposalStatus.ChangesRequested, openChangeRequestId: crId } },
    );
  await say(
    c,
    p,
    Party.System,
    NAMES.system,
    THREAD.changesRequested(
      author,
      changes.length,
      doc.currentRevision,
      formatMoney(all.totalCents, all.currency),
    ),
    when,
  );
  return cr;
};

const decide = async (
  c: Ctx,
  p: Seeded,
  cr: ChangeRequestDoc,
  rep: UserDoc,
  approvals: boolean[],
  when: Date,
  note?: string,
) => {
  const { doc, rev, house } = await revisionOf(c, p);
  const approved = cr.changes.filter((_, i) => approvals[i]).map((x) => x.change);
  const selections = applyChanges(rev.selections, approved, packageContents(c.catalog));
  const quote = priced(c, house, selections, rev.quote.adjustments, {
    tax: c.tax,
    referral: rev.quote.referral ?? null,
  });
  const number = doc.currentRevision + 1;
  await c.repo.of<RevisionDoc>('revisions').insertOne({
    _id: newId(),
    proposalId: doc._id,
    number,
    selections,
    quote,
    authorName: rep.name,
    changeRequestId: cr._id,
    createdAt: when.toISOString(),
    ...(note && { note }),
  });
  await c.repo.of<ChangeRequestDoc>('changeRequests').updateOne(
    { _id: cr._id },
    {
      $set: {
        status: ChangeRequestStatus.Resolved,
        resolvedAt: when.toISOString(),
        resolvedByName: rep.name,
        resultRevision: number,
        changes: cr.changes.map((x, i) => ({
          ...x,
          decision: approvals[i] ? ChangeDecision.Approved : ChangeDecision.Declined,
          ...(!approvals[i] && note && { decisionNote: note }),
        })),
      },
    },
  );
  await c.repo.of<ProposalDoc>('proposals').updateOne(
    { _id: doc._id },
    {
      $set: {
        status: ProposalStatus.Proposed,
        currentRevision: number,
        currentTotalCents: quote.totalCents,
      },
      $unset: { openChangeRequestId: '' },
    },
  );
  await say(
    c,
    p,
    Party.System,
    NAMES.system,
    THREAD.decided(
      rep.name,
      approved.length,
      cr.changes.length,
      number,
      formatMoney(quote.totalCents, quote.currency),
      true,
    ),
    when,
  );
  if (note) await say(c, p, Party.Seller, rep.name, note, when);
};

const sign = async (c: Ctx, p: Seeded, fullName: string, when: Date) => {
  const { doc } = await revisionOf(c, p);
  await c.repo.of<ProposalDoc>('proposals').updateOne(
    { _id: doc._id },
    {
      $set: {
        status: ProposalStatus.Signed,
        signature: {
          fullName,
          revision: doc.currentRevision,
          totalCents: doc.currentTotalCents,
          signedAt: when.toISOString(),
        },
      },
    },
  );
  if (doc.inventoryHomeId) {
    await c.repo
      .of<InventoryHomeDoc>('inventoryHomes')
      .updateOne({ _id: doc.inventoryHomeId }, { $set: { status: InventoryStatus.Reserved } });
  }
  await say(
    c,
    p,
    Party.System,
    NAMES.system,
    THREAD.signed(fullName, doc.currentRevision, formatMoney(doc.currentTotalCents, doc.currency)),
    when,
  );
};

interface AgreementPlan {
  rep: UserDoc;
  when: Date;
  purchasers: readonly { name: string; email: string }[];
  deposits: readonly { label: string; dollars: number; dueInDays?: number }[];
  closingInDays: number;
  countersignedBy?: UserDoc;
}

/** The agreement of a signed proposal, signed by every purchaser; with a countersigner it is
 * executed, and its PDF kept, the way a countersignature keeps it. */
const seedAgreement = async (
  c: Ctx,
  company: CompanyDoc,
  p: Seeded,
  plan: AgreementPlan,
): Promise<AgreementDoc> => {
  const { doc, rev, house } = await revisionOf(c, p);
  const template = (await c.repo
    .of<AgreementTemplateDoc>('agreementTemplates')
    .findOne({ isDefault: true }))!;
  const day = (offset: number) =>
    at(plan.when, offset * 24 * 60)
      .toISOString()
      .slice(0, 10);
  const content = composeAgreement({
    reference: reference('A'),
    preparedAt: plan.when,
    company,
    proposal: { ...doc, signature: doc.signature! },
    revision: rev,
    house,
    template,
    purchasers: withIds([...plan.purchasers]),
    terms: {
      deposits: plan.deposits.map((d) => ({
        label: d.label,
        amountCents: cents(d.dollars),
        ...(d.dueInDays !== undefined && { dueDate: day(d.dueInDays) }),
      })),
      conditions: [],
      closingDate: day(plan.closingInDays),
    },
  });
  const ts = plan.when.toISOString();
  const signature = (fullName: string) => ({
    fullName,
    signedAt: ts,
    contentHash: content.contentHash,
    provider: builtInSignatureProvider.id,
  });
  const signed: AgreementDoc = {
    _id: newId(),
    companyId: c.repo.companyId,
    ...content,
    status: AgreementStatus.Signed,
    purchasers: content.purchasers.map((purchaser) => ({
      ...purchaser,
      status: SignerStatus.Signed,
      invitedAt: ts,
      signature: { ...signature(purchaser.name), initials: keyClauses(content.sections) },
    })),
    issuedAt: ts,
    issuedByName: plan.rep.name,
    signedAt: ts,
    createdByName: plan.rep.name,
    createdAt: ts,
    updatedAt: ts,
  };
  const { companyId: _, ...agreement } = plan.countersignedBy
    ? await executed(c, signed, signature(plan.countersignedBy.name))
    : signed;
  const saved = await c.repo.of<AgreementDoc>('agreements').insertOne(agreement);
  await c.repo
    .of<ProposalDoc>('proposals')
    .updateOne({ _id: doc._id }, { $set: { agreementId: saved._id } });
  const tell = (body: string) => say(c, p, Party.System, NAMES.system, body, plan.when);
  await tell(THREAD.agreementSent(plan.rep.name, saved.reference));
  await tell(THREAD.agreementAllSigned(saved.reference));
  if (plan.countersignedBy) {
    await tell(THREAD.agreementExecuted(plan.countersignedBy.name, saved.reference));
    if (doc.inventoryHomeId) {
      await c.repo
        .of<InventoryHomeDoc>('inventoryHomes')
        .updateOne({ _id: doc.inventoryHomeId }, { $set: { status: InventoryStatus.Sold } });
    }
  }
  return saved;
};

const executed = async (
  c: Ctx,
  signed: AgreementDoc,
  counterSignature: AgreementDoc['purchasers'][number]['signature'] & object,
): Promise<AgreementDoc> => {
  const doc: AgreementDoc = {
    ...signed,
    status: AgreementStatus.Executed,
    counterSignature,
    executedAt: signed.signedAt!,
  };
  const pdf = await renderAgreementPdf(toAgreement(doc));
  const executedPdf = { fileId: newId(), sha256: sha256(pdf), size: pdf.length };
  await c.repo.of<AgreementFileDoc>('agreementFiles').insertOne({
    _id: executedPdf.fileId,
    agreementId: doc._id,
    kind: 'executed',
    contentType: 'application/pdf',
    data: pdf,
    sha256: executedPdf.sha256,
    size: executedPdf.size,
    createdAt: doc.executedAt!,
  });
  return { ...doc, executedPdf };
};

const recordPayment = async (
  c: Ctx,
  p: Seeded,
  agreement: AgreementDoc,
  by: UserDoc,
  entry: Pick<PaymentDoc, 'status' | 'amountCents' | 'method' | 'externalRef' | 'note'> & {
    receivedOn: Date;
    approvedBy?: UserDoc;
  },
) => {
  const { approvedBy, ...fields } = entry;
  const ts = entry.receivedOn.toISOString();
  const actor = (u: UserDoc) => ({ id: u._id, name: u.name, role: u.role as CompanyRole });
  await c.repo.of<PaymentDoc>('agreementPayments').insertOne({
    _id: newId(),
    reference: reference('PAY'),
    agreementId: agreement._id,
    agreementReference: agreement.reference,
    kind: PaymentKind.Payment,
    currency: agreement.currency,
    ...fields,
    receivedOn: ts.slice(0, 10),
    recordedBy: actor(by),
    recordedAt: ts,
    ...(approvedBy && { reviewedBy: actor(approvedBy), reviewedAt: ts }),
    history: [
      { at: ts, by: actor(by), action: PaymentAction.Recorded },
      ...(approvedBy ? [{ at: ts, by: actor(approvedBy), action: PaymentAction.Approved }] : []),
    ],
    updatedAt: ts,
  });
  if (entry.status === PaymentStatus.Posted) {
    const amount = formatMoney(entry.amountCents, agreement.currency);
    const body = THREAD.paymentReceived(amount, agreement.reference, ts.slice(0, 10));
    await say(c, p, Party.System, NAMES.system, body, entry.receivedOn);
  }
};

export interface SummaryOptions {
  showcaseOrigins: string[];
  secondOrigin: string;
  platformOrigin: string;
  platformEmail: string;
  password: string;
}

/** What the seed prints once the demo is seeded: where to go, and who to sign in as. */
export const showcaseSummary = (result: ShowcaseResult, o: SummaryOptions): string => {
  if (!result.created) {
    return `\n  Already seeded; origins refreshed (${o.showcaseOrigins.join(', ')}).\n`;
  }
  const site = o.showcaseOrigins[0];
  const login = (role: Role) =>
    `${SHOWCASE_COMPANY.team.find((m) => m.role === role)!.email} / ${o.password}`;
  return [
    '',
    '  Example Homes — negotiation demo is ready',
    '  ─────────────────────────────────────────',
    `  Seller console    ${site}/console   ${login(Role.CompanyStaff)}`,
    `  Finance console   ${site}/console/payments   ${login(Role.CompanyFinance)}`,
    `  Buyer account     ${site}            ${SHOWCASE_COMPANY.buyer.email} / ${o.password}`,
    `  Platform console  ${o.platformOrigin}   ${o.platformEmail}`,
    `  Second tenant     ${o.secondOrigin}   (Northwind Homes, fictional)`,
    `  Purchase agreement  ${site}/console/agreements   (Jamie Okafor's signed proposal is ready for one)`,
    `  Payments          ${site}/console/payments   (the Lees' second deposit waits for finance)`,
    `  Buyer with a contract  ${site}/proposals   ${STORY.rivera.buyer.email} / ${o.password}   (pre-existing home, executed, receipts)`,
    '  Buyer invite links (open in a private window):',
    ...(result.invites ?? []).map((i) => `    ${i.label}: ${site}/k?key=${i.key}`),
    '',
  ].join('\n');
};

const seedNorthwind = async (db: Db, opts: ShowcaseOptions) => {
  const { company, created } = await upsertCompany(db, {
    name: NORTHWIND.name,
    slug: NORTHWIND.slug,
    logoUrl: opts.northwindLogoUrl,
    origins: opts.northwindOrigins,
    currency: 'CAD',
    active: true,
    tagline: NORTHWIND.tagline,
  });
  if (!created) return;
  const repo = tenantRepo(db, company._id);
  const admin = await addUser(
    repo,
    { ...NORTHWIND_DATA.admin, role: Role.CompanyAdmin },
    opts.password,
  );
  await seedTemplates(repo, AGREEMENT_TEMPLATES.northwind, admin.name, new Date());
  await repo.of<AreaDoc>('areas').insertOne({ _id: newId(), ...NORTHWIND_DATA.area, order: 0 });
  const island = newId();
  await repo.of<CatalogItemDoc>('catalogItems').insertOne({
    _id: island,
    areaSlug: NORTHWIND_DATA.area.slug,
    name: NORTHWIND_DATA.item,
    priceCents: cents(8_500),
  });
  const ts = new Date().toISOString();
  for (const [name, slug, sqft, price] of [
    ['Aspen', 'aspen', 1650, 529_000],
    ['Cedar', 'cedar', 2100, 645_000],
  ] as const) {
    await repo.of<HouseDoc>('houses').insertOne({
      _id: newId(),
      name,
      slug,
      style: NORTHWIND_DATA.style,
      headline: NORTHWIND_DATA.headline,
      description: NORTHWIND_DATA.description,
      communities: [NORTHWIND_DATA.community],
      specs: { sqft, beds: 3, baths: 2.5, garage: 2, storeys: 2 },
      images: [],
      floorPlanImages: [],
      basePriceCents: cents(price),
      priceOverrides: [],
      status: HouseStatus.Published,
      createdAt: ts,
      updatedAt: ts,
    });
  }
};
