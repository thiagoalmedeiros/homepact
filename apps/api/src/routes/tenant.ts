import type { TenantBranding } from '@homepact/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { findCompany } from '../data/platform-repo.js';
import { notFound } from '../http/errors.js';
import { NAMES } from '../messages.js';

/** Public branding of the Origin's company (the white-label web app reads its logo here). */
export const tenantRouter = (db: Db): Router => {
  const router = Router();
  router.get('/', async (req, res) => {
    if (req.tenant.kind === 'platform') {
      res.json({ kind: 'platform', name: NAMES.platform } satisfies TenantBranding);
      return;
    }
    const company = await findCompany(db, req.tenant.companyId);
    if (!company) throw notFound();
    res.json({
      kind: 'company',
      name: company.name,
      logoUrl: company.logoUrl,
      currency: company.currency,
      ...(company.tagline && { tagline: company.tagline }),
      ...(company.heroImageUrl && { heroImageUrl: company.heroImageUrl }),
      ...(company.contact && { contact: company.contact }),
    } satisfies TenantBranding);
  });
  return router;
};
