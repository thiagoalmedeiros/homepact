import { AccessKeyStatus, AccessResourceType } from '@homepact/shared';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../src/auth/tokens.js';
import {
  assertKeyActive,
  createAccessKey,
  hashCode,
  toKeyInfo,
} from '../../../src/modules/access-keys/keys.js';
import { accessKeyDoc } from '../../support/fixtures.js';
import { BUYER, NOW, NOW_ISO, keyHolder, mockRepo, type MockRepo } from '../../support/mocks.js';

vi.mock('../../../src/data/ids.js', () => ({
  newId: vi.fn(() => 'key-new'),
  randomToken: vi.fn(() => 'plaintext-key'),
  sha256: vi.fn((v: string) => `sha256(${v})`),
}));
const ids = await import('../../../src/data/ids.js');

let repo: MockRepo;
beforeEach(() => {
  repo = mockRepo();
});

describe('toKeyInfo', () => {
  it('never exposes the hash', () => {
    expect(toKeyInfo(accessKeyDoc())).toEqual({
      id: 'key-1',
      resourceType: AccessResourceType.Proposal,
      resourceId: 'proposal-1',
      status: AccessKeyStatus.Active,
      createdAt: NOW_ISO,
    });
    expect(toKeyInfo(accessKeyDoc({ lastUsedAt: 'later' }))).toMatchObject({ lastUsedAt: 'later' });
  });

  it('says when a link also needs a code, and who it signs for', () => {
    expect(
      toKeyInfo(
        accessKeyDoc({
          resourceType: AccessResourceType.Agreement,
          codeHash: 'sha256(key-1:ABCD-EFGH)',
          signerId: 'pur-1',
        }),
      ),
    ).toMatchObject({ needsCode: true, signerId: 'pur-1' });
  });
});

describe('hashCode', () => {
  it('salts a short code with the key it belongs to, and ignores case and spacing', () => {
    expect(hashCode('key-1', ' abcd-efgh ')).toBe('sha256(key-1:ABCD-EFGH)');
    expect(hashCode('key-1', 'ABCD-EFGH')).toBe(hashCode('key-1', 'abcd-efgh'));
    expect(hashCode('key-2', 'ABCD-EFGH')).not.toBe(hashCode('key-1', 'ABCD-EFGH'));
  });
});

describe('createAccessKey', () => {
  it('stores only the SHA-256 of a 256-bit key and returns the plaintext once', async () => {
    const { key, doc } = await createAccessKey(repo, AccessResourceType.Proposal, 'proposal-1', {
      createdBy: 'staff-1',
      now: NOW,
    });
    expect(ids.randomToken).toHaveBeenCalledWith(32);
    expect(key).toBe('plaintext-key');
    expect(repo.col('accessKeys').insertOne).toHaveBeenCalledWith({
      _id: 'key-new',
      hash: 'sha256(plaintext-key)',
      resourceType: AccessResourceType.Proposal,
      resourceId: 'proposal-1',
      status: AccessKeyStatus.Active,
      createdBy: 'staff-1',
      createdAt: NOW_ISO,
    });
    expect(doc).not.toHaveProperty('key');
    expect(JSON.stringify(doc)).not.toContain('"plaintext-key"');
  });

  it('a signing link stores the hash of its code and the purchaser it belongs to', async () => {
    await createAccessKey(repo, AccessResourceType.Agreement, 'agr-1', {
      createdBy: 'staff-1',
      now: NOW,
      code: 'ABCD-EFGH',
      signerId: 'pur-2',
    });
    expect(repo.col('accessKeys').insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: AccessResourceType.Agreement,
        resourceId: 'agr-1',
        codeHash: 'sha256(key-new:ABCD-EFGH)',
        signerId: 'pur-2',
      }),
    );
    expect(JSON.stringify(repo.col('accessKeys').insertOne.mock.calls)).not.toContain(
      '"ABCD-EFGH"',
    );
  });
});

describe('assertKeyActive', () => {
  const request = (principal?: Principal) => ({ repo, principal }) as unknown as Request;

  it('ignores everyone but key holders', async () => {
    await assertKeyActive(request(BUYER));
    await assertKeyActive(request());
    expect(repo.of).not.toHaveBeenCalled();
  });

  it("passes while the holder's key is active", async () => {
    repo.col('accessKeys').findOne.mockResolvedValue(accessKeyDoc());
    await expect(assertKeyActive(request(keyHolder('proposal-1')))).resolves.toBeUndefined();
    expect(repo.col('accessKeys').findOne).toHaveBeenCalledWith({
      _id: 'key-1',
      status: AccessKeyStatus.Active,
    });
  });

  it('is a 404 once the key is revoked or claimed', async () => {
    await expect(assertKeyActive(request(keyHolder('proposal-1')))).rejects.toMatchObject({
      status: 404,
    });
  });
});
