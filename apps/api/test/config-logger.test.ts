import { Writable } from 'node:stream';
import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { REDACT_PATHS, createLogger, redactUrl } from '../src/logger.js';

describe('loadConfig', () => {
  beforeEach(() => {
    for (const name of [
      'NODE_ENV',
      'JWT_SECRET',
      'API_PORT',
      'LOG_LEVEL',
      'PLATFORM_ADMIN_ORIGIN',
      'MONGO_URI',
      'MONGO_DB_NAME',
    ]) {
      vi.stubEnv(name, undefined);
    }
  });

  it('uses development defaults', () => {
    vi.stubEnv('MONGO_URI', 'mongodb://db');
    expect(loadConfig()).toEqual({
      env: 'development',
      port: 3000,
      logLevel: 'info',
      platformAdminOrigin: 'http://localhost:4300',
      jwtSecret: 'dev-only-secret',
      mongo: { uri: 'mongodb://db', dbName: 'homepact' },
    });
  });

  it('reads every setting from the environment and normalizes the admin origin', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('JWT_SECRET', 's');
    vi.stubEnv('API_PORT', '8080');
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('PLATFORM_ADMIN_ORIGIN', 'http://ADMIN.test/');
    vi.stubEnv('MONGO_URI', 'mongodb://db');
    vi.stubEnv('MONGO_DB_NAME', 'other');
    expect(loadConfig()).toMatchObject({
      env: 'test',
      port: 8080,
      logLevel: 'debug',
      platformAdminOrigin: 'http://admin.test',
      jwtSecret: 's',
      mongo: { dbName: 'other' },
    });
  });

  it('requires MONGO_URI', () => {
    expect(() => loadConfig()).toThrow('Missing required environment variable: MONGO_URI');
  });

  it('requires a strong JWT_SECRET in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MONGO_URI', 'mongodb://db');
    expect(() => loadConfig()).toThrow('Missing required environment variable: JWT_SECRET');
    vi.stubEnv('JWT_SECRET', 'too-short');
    expect(() => loadConfig()).toThrow('JWT_SECRET must be at least 32 characters in production');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
    expect(loadConfig().jwtSecret).toBe('x'.repeat(32));
  });
});

describe('logger', () => {
  it('redactUrl hides key and token query values', () => {
    expect(redactUrl('/api/access?key=abc&x=1&TOKEN=t#frag')).toBe(
      '/api/access?key=[REDACTED]&x=1&TOKEN=[REDACTED]#frag',
    );
    expect(redactUrl('/api/houses?monkey=1')).toBe('/api/houses?monkey=1');
    expect(redactUrl(undefined)).toBeUndefined();
  });

  it('REDACT_PATHS keep credentials and secrets out of log lines', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    pino({ redact: REDACT_PATHS }, stream).info({
      req: {
        headers: { authorization: 'Bearer jwt-secret', cookie: 'sid=cookie-secret' },
        body: { password: 'pw-secret', key: 'key-secret', refreshToken: 'rt-secret', name: 'Bea' },
        query: { key: 'query-secret' },
      },
      res: { headers: { 'set-cookie': 'set-cookie-secret' } },
    });
    const out = lines.join('');
    expect(out).toContain('Bea');
    for (const secret of [
      'jwt-secret',
      'sid=cookie-secret',
      'pw-secret',
      'key-secret',
      'rt-secret',
      'query-secret',
      'set-cookie-secret',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[Redacted]');
  });

  it('logs JSON with service metadata in production', () => {
    const logger = createLogger({ env: 'production', level: 'warn' });
    expect(logger.level).toBe('warn');
    expect(logger.bindings()).toEqual({ service: 'homepact-api', env: 'production' });
  });
});
