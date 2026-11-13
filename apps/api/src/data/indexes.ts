import type { Db } from 'mongodb';

/** Creates indexes at boot. Every tenant index leads with `companyId`. */
export const ensureIndexes = async (db: Db): Promise<void> => {
  await Promise.all([
    db.collection('companies').createIndex({ origins: 1 }, { unique: true }),
    db.collection('companies').createIndex({ slug: 1 }, { unique: true }),
    db.collection('users').createIndex({ companyId: 1, email: 1 }, { unique: true }),
    db.collection('refreshTokens').createIndex({ companyId: 1, hash: 1 }, { unique: true }),
    db.collection('refreshTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('areas').createIndex({ companyId: 1, slug: 1 }, { unique: true }),
    db.collection('catalogItems').createIndex({ companyId: 1, areaSlug: 1 }),
    db.collection('packages').createIndex({ companyId: 1, areaSlug: 1 }),
    db.collection('houses').createIndex({ companyId: 1, slug: 1 }, { unique: true }),
    db.collection('houses').createIndex({ companyId: 1, status: 1 }),
    db.collection('inventoryHomes').createIndex({ companyId: 1, status: 1 }),
    db.collection('proposals').createIndex({ companyId: 1, lastActivityAt: -1 }),
    db.collection('proposals').createIndex({ companyId: 1, buyerUserId: 1 }),
    db
      .collection('revisions')
      .createIndex({ companyId: 1, proposalId: 1, number: 1 }, { unique: true }),
    db.collection('changeRequests').createIndex({ companyId: 1, proposalId: 1, createdAt: 1 }),
    db.collection('proposalMessages').createIndex({ companyId: 1, proposalId: 1, createdAt: 1 }),
    db.collection('accessKeys').createIndex({ hash: 1 }, { unique: true }),
    db.collection('accessKeys').createIndex({ companyId: 1, resourceType: 1, resourceId: 1 }),
    db.collection('agreementTemplates').createIndex({ companyId: 1, name: 1 }, { unique: true }),
    db.collection('agreements').createIndex({ companyId: 1, updatedAt: -1 }),
    db.collection('agreements').createIndex({ companyId: 1, proposalId: 1 }),
    db.collection('agreementFiles').createIndex({ companyId: 1, agreementId: 1 }),
    db
      .collection('agreementPayments')
      .createIndex({ companyId: 1, agreementId: 1, receivedOn: 1, recordedAt: 1 }),
    db.collection('agreementPayments').createIndex({ companyId: 1, status: 1, recordedAt: 1 }),
    db.collection('taxPresets').createIndex({ code: 1 }),
    db.collection('taxRates').createIndex({ companyId: 1, code: 1 }, { unique: true }),
    db.collection('referralPrograms').createIndex({ companyId: 1, name: 1 }),
  ]);
};
