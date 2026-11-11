import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso, randomToken, reference, sha256 } from '../../src/data/ids.js';

const driver = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  command: vi.fn(),
  options: [] as unknown[],
}));

vi.mock('mongodb', () => ({
  MongoClient: class {
    constructor(uri: string, options: unknown) {
      driver.options.push({ uri, options });
    }
    connect = driver.connect;
    close = driver.close;
    db = (name: string) => ({ name, command: driver.command });
  },
}));

const { connectDatabase } = await import('../../src/db.js');

describe('ids', () => {
  it('newId returns UUIDs', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(newId()).not.toBe(newId());
  });

  it('nowIso returns an ISO timestamp', () => {
    vi.useFakeTimers({ now: new Date('2026-10-31T12:00:00.000Z') });
    expect(nowIso()).toBe('2026-10-31T12:00:00.000Z');
    vi.useRealTimers();
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('randomToken is base64url of the requested size', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken()).not.toBe(randomToken());
  });

  it('sha256 is the hex digest', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(Buffer.from('abc'))).toBe(sha256('abc'));
  });

  it('reference is a readable code without ambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(reference('P')).toMatch(/^P-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });
});

describe('connectDatabase', () => {
  const logger = { info: vi.fn(), warn: vi.fn() };

  beforeEach(() => {
    driver.options.length = 0;
  });

  it('connects with a short server-selection timeout and exposes ping and close', async () => {
    driver.connect.mockResolvedValue(undefined);
    driver.command.mockResolvedValue({ ok: 1 });
    const database = await connectDatabase({ uri: 'mongodb://db', dbName: 'hc' }, logger as never);
    expect(driver.options).toEqual([
      { uri: 'mongodb://db', options: { serverSelectionTimeoutMS: 5000, ignoreUndefined: true } },
    ]);
    expect(database.db).toMatchObject({ name: 'hc' });
    expect(logger.info).toHaveBeenCalledWith({ dbName: 'hc' }, 'Connected to MongoDB');

    await database.ping();
    expect(driver.command).toHaveBeenCalledWith({ ping: 1 });
    await database.close();
    expect(driver.close).toHaveBeenCalled();
  });

  it('still returns a client when MongoDB is down, so the API can report degraded health', async () => {
    const err = new Error('ECONNREFUSED');
    driver.connect.mockRejectedValue(err);
    driver.command.mockRejectedValue(err);
    const database = await connectDatabase({ uri: 'mongodb://db', dbName: 'hc' }, logger as never);
    expect(logger.warn).toHaveBeenCalledWith(
      { err, dbName: 'hc' },
      'MongoDB not reachable yet; will retry on demand',
    );
    await expect(database.ping()).rejects.toThrow('ECONNREFUSED');
  });
});
