import type { AgreementSection, AgreementTemplate } from '@homepact/shared';
import type { TenantDoc } from '../../data/tenant-repo.js';

export interface AgreementTemplateDoc extends TenantDoc, Omit<AgreementTemplate, 'id'> {}

/** Stores only the clauses that are marked as key clauses, not a `false` on every other one. */
export const normalizeSections = (
  sections: { heading: string; body: string; requiresInitials?: boolean }[],
): AgreementSection[] =>
  sections.map((s) => ({
    heading: s.heading,
    body: s.body,
    ...(s.requiresInitials && { requiresInitials: true }),
  }));

export const toTemplate = ({
  _id,
  companyId: _c,
  ...rest
}: AgreementTemplateDoc): AgreementTemplate => ({
  id: _id,
  ...rest,
});
