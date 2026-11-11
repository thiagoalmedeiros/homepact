import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
/** Short signing code, e.g. "7KQ2-9XMA", without characters misread over the phone (I, O, 0, 1). */
export const randomCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
};

/** Human-friendly negotiation reference, e.g. "N-7KQ2-9XMA". */
export const reference = (prefix: string): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${prefix}-${chars.slice(0, 4)}-${chars.slice(4)}`;
};
