import { SignerStatus } from '@homepact/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  identityOf,
  mergePurchasers,
  withIds,
} from '../../../src/modules/agreements/purchasers.js';
import { purchaserDoc, signature, signedPurchaser } from '../../support/fixtures.js';

vi.mock('../../../src/data/ids.js', () => ({ newId: vi.fn(() => 'id-1') }));

describe('purchaser identities', () => {
  it('keeps the id of a purchaser who stays on the agreement, so their link keeps working', () => {
    const existing = [
      purchaserDoc({ id: 'pur-1', name: 'Bea Buyer', email: 'bea@buyer.test' }),
      purchaserDoc({ id: 'pur-2', name: 'Ben Buyer', email: undefined }),
    ];
    expect(
      withIds([{ name: 'Bea B. Buyer', email: 'bea@buyer.test' }, { name: 'Ben Buyer' }], existing),
    ).toEqual([
      { id: 'pur-1', name: 'Bea B. Buyer', email: 'bea@buyer.test' },
      { id: 'pur-2', name: 'Ben Buyer' },
    ]);
    expect(withIds([{ name: 'Cam Buyer' }], existing)).toEqual([{ id: 'id-1', name: 'Cam Buyer' }]);
  });

  it('re-attaches what each purchaser has already done', () => {
    const existing = [signedPurchaser({ id: 'pur-1' })];
    expect(mergePurchasers([{ id: 'pur-1', name: 'Bea Buyer' }], existing)).toEqual([
      { id: 'pur-1', name: 'Bea Buyer', status: SignerStatus.Signed, signature: signature() },
    ]);
    expect(mergePurchasers([{ id: 'new', name: 'Cam' }], existing)).toEqual([
      { id: 'new', name: 'Cam', status: SignerStatus.Pending },
    ]);
  });

  it('who a purchaser is, without how far they are with signing', () => {
    expect(identityOf(signedPurchaser({ phone: '555-1', invitedAt: 'x' }))).toEqual({
      id: 'pur-1',
      name: 'Bea Buyer',
      email: 'bea@buyer.test',
      phone: '555-1',
    });
  });
});
