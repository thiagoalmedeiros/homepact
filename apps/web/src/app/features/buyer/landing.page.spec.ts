import { keyFromInvite } from './landing.page';

describe('keyFromInvite', () => {
  it('accepts a full invite link or the bare key', () => {
    const key = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    expect(keyFromInvite(`https://homes.test/k?key=${key}`)).toBe(key);
    expect(keyFromInvite(`  ${key} `)).toBe(key);
    expect(keyFromInvite('hello')).toBeNull();
    expect(keyFromInvite('')).toBeNull();
  });
});
