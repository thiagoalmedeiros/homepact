import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when only MONGO_URI is set', () => {
    const config = loadConfig({ MONGO_URI: 'mongodb://localhost:27017' });
    expect(config).toEqual({
      env: 'development',
      port: 3000,
      logLevel: 'info',
      mongoUri: 'mongodb://localhost:27017',
      mongoDbName: 'homepact',
    });
  });

  it('parses the port as a number', () => {
    expect(loadConfig({ MONGO_URI: 'x', API_PORT: '8080' }).port).toBe(8080);
  });

  it('rejects a missing MONGO_URI', () => {
    expect(() => loadConfig({})).toThrow(/MONGO_URI/);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ MONGO_URI: 'x', API_PORT: '99999' })).toThrow(/API_PORT/);
  });
});
