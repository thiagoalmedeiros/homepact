import { AccessResourceType, GuestRole, Role } from '@homepact/shared';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/passwords.js';
import { createTokenService, type Principal } from '../../src/auth/tokens.js';

describe('passwords', () => {
  it('hashes with scrypt and a random salt, never storing the password', async () => {
    const a = await hashPassword('correct-horse');
    const b = await hashPassword('correct-horse');
    expect(a).toMatch(/^scrypt\$[\w-]+\$[\w-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct-horse');
  });

  it('verifies the right password only', async () => {
    const stored = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', stored)).toBe(true);
    expect(await verifyPassword('wrong-horse', stored)).toBe(false);
  });

  it('rejects malformed or foreign hashes', async () => {
    expect(await verifyPassword('x', 'bcrypt$a$b')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$only-salt')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('token service', () => {
  const tokens = createTokenService('a-test-secret-that-is-long-enough!!');
  const principal: Principal = { sub: 'u1', role: Role.Buyer, companyId: 'co-1', name: 'Bea' };

  it('round-trips a principal', async () => {
    expect(await tokens.verify(await tokens.sign(principal))).toEqual(principal);
  });

  it('round-trips a key holder with their resource, and a platform principal', async () => {
    const holder: Principal = {
      sub: 'k1',
      role: GuestRole.KeyHolder,
      companyId: 'co-1',
      name: 'Guest',
      resource: { type: AccessResourceType.Proposal, id: 'p1' },
    };
    expect(await tokens.verify(await tokens.sign(holder, 60))).toEqual(holder);
    const root: Principal = { sub: 's', role: Role.SuperAdmin, companyId: null, name: 'Root' };
    expect(await tokens.verify(await tokens.sign(root))).toEqual(root);
  });

  it('refuses tokens signed with another secret, garbage and expired tokens', async () => {
    const other = createTokenService('another-secret-that-is-long-enough!!');
    expect(await tokens.verify(await other.sign(principal))).toBeNull();
    expect(await tokens.verify('not-a-jwt')).toBeNull();
    expect(await tokens.verify(await tokens.sign(principal, -10))).toBeNull();
  });

  it('refuses tokens without a subject or role', async () => {
    const key = new TextEncoder().encode('a-test-secret-that-is-long-enough!!');
    const noRole = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .sign(key);
    const noSub = await new SignJWT({ role: Role.Buyer })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(key);
    expect(await tokens.verify(noRole)).toBeNull();
    expect(await tokens.verify(noSub)).toBeNull();
  });
});
