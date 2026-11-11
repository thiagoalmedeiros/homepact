import { SignerStatus, type AgreementPurchaser } from '@homepact/shared';
import { newId } from '../../data/ids.js';

export type PurchaserIdentity = Pick<
  AgreementPurchaser,
  'id' | 'name' | 'email' | 'phone' | 'address'
>;

export const identityOf = ({
  id,
  name,
  email,
  phone,
  address,
}: PurchaserIdentity): PurchaserIdentity => ({
  id,
  name,
  ...(email && { email }),
  ...(phone && { phone }),
  ...(address && { address }),
});

/** Matched on email, or on the name without one. */
const samePerson = (a: Omit<PurchaserIdentity, 'id'>, b: Omit<PurchaserIdentity, 'id'>) =>
  (a.email ?? a.name).trim().toLowerCase() === (b.email ?? b.name).trim().toLowerCase();

/** Gives each listed purchaser an id; those already on the agreement keep theirs, so their signing
 * links keep working. */
export const withIds = (
  listed: Omit<PurchaserIdentity, 'id'>[],
  existing: AgreementPurchaser[] = [],
): PurchaserIdentity[] => {
  const pool = [...existing];
  return listed.map((p) => {
    const i = pool.findIndex((e) => samePerson(e, p));
    const id = i >= 0 ? pool.splice(i, 1)[0]!.id : newId();
    return identityOf({ ...p, id });
  });
};

/** Re-attaches what each purchaser has already done to the identities being written. */
export const mergePurchasers = (
  identities: PurchaserIdentity[],
  existing: AgreementPurchaser[],
): AgreementPurchaser[] =>
  identities.map((identity) => {
    const previous = existing.find((e) => e.id === identity.id);
    return {
      ...identity,
      status: previous?.status ?? SignerStatus.Pending,
      ...(previous?.invitedAt && { invitedAt: previous.invitedAt }),
      ...(previous?.signature && { signature: previous.signature }),
      ...(previous?.invalidatedAt && { invalidatedAt: previous.invalidatedAt }),
    };
  });
