import {
  AccessResourceType,
  GuestRole,
  Party,
  Role,
  type Catalog,
  type Change,
  type ChangeRequest,
  type Proposal,
  type ProposalDetail,
  type ProposalMessage,
  type ProposalParty,
  type Revision,
  type Selections,
} from '@homepact/shared';
import type { Request } from 'express';
import { isStaff } from '../../auth/require-auth.js';
import { newId } from '../../data/ids.js';
import type { TenantDoc, TenantRepo } from '../../data/tenant-repo.js';
import { notFound } from '../../http/errors.js';
import { assertKeyActive } from '../access-keys/keys.js';
import { agreementOfProposal } from '../agreements/store.js';
import { CHANGE_LABELS, NAMES } from '../../messages.js';

export interface ProposalDoc extends TenantDoc, Omit<Proposal, 'id'> {
  agreementId?: string;
}
export interface RevisionDoc extends TenantDoc, Omit<Revision, 'id'> {}
export interface ChangeRequestDoc extends TenantDoc, Omit<ChangeRequest, 'id'> {}
export interface MessageDoc extends TenantDoc, Omit<ProposalMessage, 'id'> {}

const strip = <T extends TenantDoc>({ _id, companyId: _c, ...rest }: T) => ({ id: _id, ...rest });
export const toProposal = ({ agreementId: _a, ...d }: ProposalDoc): Proposal =>
  strip(d) as Proposal;
export const toRevision = (d: RevisionDoc): Revision => strip(d) as Revision;
export const toChangeRequest = (d: ChangeRequestDoc): ChangeRequest => strip(d) as ChangeRequest;
export const toMessage = (d: MessageDoc): ProposalMessage => strip(d) as ProposalMessage;

export const partyOf = (req: Request): ProposalParty =>
  isStaff(req.principal) ? Party.Seller : Party.Buyer;

/** Loads a proposal the caller may see (staff, its buyer or its invite key); anything else is
 * not found. */
export const loadProposalFor = async (req: Request, id: string): Promise<ProposalDoc> => {
  const doc = await req.repo.of<ProposalDoc>('proposals').findOne({ _id: id });
  const p = req.principal;
  if (!doc || !p) throw notFound();
  if (isStaff(p)) return doc;
  if (p.role === Role.Buyer && doc.buyerUserId === p.sub) return doc;
  if (
    p.role === GuestRole.KeyHolder &&
    p.resource?.type === AccessResourceType.Proposal &&
    p.resource.id === doc._id
  ) {
    await assertKeyActive(req);
    return doc;
  }
  throw notFound();
};

export const addMessage = (
  repo: TenantRepo,
  proposalId: string,
  party: MessageDoc['party'],
  authorName: string,
  body: string,
  at: Date,
) =>
  repo.of<MessageDoc>('proposalMessages').insertOne({
    _id: newId(),
    proposalId,
    party,
    authorName,
    body,
    createdAt: at.toISOString(),
  });

export const loadDetail = async (req: Request, doc: ProposalDoc): Promise<ProposalDetail> => {
  const viewerParty = partyOf(req);
  const [revisions, changeRequests, messages, agreement] = await Promise.all([
    req.repo.of<RevisionDoc>('revisions').find({ proposalId: doc._id }, { sort: { number: 1 } }),
    req.repo
      .of<ChangeRequestDoc>('changeRequests')
      .find({ proposalId: doc._id }, { sort: { createdAt: 1 } }),
    req.repo
      .of<MessageDoc>('proposalMessages')
      .find({ proposalId: doc._id }, { sort: { createdAt: 1 } }),
    agreementOfProposal(req.repo, doc.agreementId, viewerParty),
  ]);
  return {
    proposal: toProposal(doc),
    revisions: revisions.map(toRevision),
    changeRequests: changeRequests.map(toChangeRequest),
    messages: messages.map(toMessage),
    viewerParty,
    ...(agreement && { agreement }),
  };
};

export const authorName = (req: Request, doc: Pick<ProposalDoc, 'buyer'>): string =>
  req.principal?.role === GuestRole.KeyHolder
    ? (doc.buyer.name ?? NAMES.buyer)
    : (req.principal?.name ?? NAMES.buyer);

/** What a package contains, for breaking it into individual items. */
export const packageContents = (catalog: Catalog) => (packageId: string) =>
  catalog.packages.find((p) => p.id === packageId)?.itemIds;

/** A readable description of a requested change, e.g. "Change Interior: Advantage → Signature". */
export const describeChange = (change: Change, base: Selections, catalog: Catalog): string => {
  const area = catalog.areas.find((a) => a.slug === change.areaSlug)?.label ?? change.areaSlug;
  const pkg = (id?: string) =>
    catalog.packages.find((p) => p.id === id)?.name ?? CHANGE_LABELS.unknownPackage;
  const item = (id: string) =>
    catalog.items.find((i) => i.id === id)?.name ?? CHANGE_LABELS.unknownItem;
  const current = base[change.areaSlug];
  const currentPkg = current && 'packageId' in current ? current.packageId : undefined;
  switch (change.type) {
    case 'add_item':
      return currentPkg
        ? CHANGE_LABELS.addToPackageItems(item(change.itemId), pkg(currentPkg), area)
        : CHANGE_LABELS.add(item(change.itemId), area);
    case 'remove_item':
      return currentPkg
        ? CHANGE_LABELS.removeFromPackage(item(change.itemId), pkg(currentPkg), area)
        : CHANGE_LABELS.remove(item(change.itemId), area);
    case 'remove_package':
      return CHANGE_LABELS.removePackage(pkg(currentPkg), area);
    case 'set_package':
      return currentPkg
        ? CHANGE_LABELS.switchPackage(area, pkg(currentPkg), pkg(change.packageId))
        : CHANGE_LABELS.choosePackage(pkg(change.packageId), area);
  }
};
