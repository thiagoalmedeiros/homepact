import { loginRequestSchema, registerRequestSchema } from '@homepact/shared';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  badRequest,
  conflict,
  errorHandler,
  forbidden,
  isDuplicateKey,
  notFound,
  parse,
  unauthorized,
  unprocessable,
} from '../../src/http/errors.js';

describe('HTTP error helpers', () => {
  it.each([
    [badRequest(), 400, 'Invalid request'],
    [unauthorized(), 401, 'Authentication required'],
    [forbidden(), 403, 'Forbidden'],
    [notFound(), 404, 'Not found'],
    [conflict('Taken'), 409, 'Taken'],
    [unprocessable('Bad option'), 422, 'Bad option'],
  ])('%s → %i', (err, status, message) => {
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status, message });
  });
});

describe('parse', () => {
  it('returns the parsed (normalized) value', () => {
    expect(parse(loginRequestSchema, { email: 'A@B.test', password: 'x' })).toEqual({
      email: 'a@b.test',
      password: 'x',
    });
  });

  it('turns schema issues into a 400 with field errors and never echoes the input', () => {
    try {
      parse(registerRequestSchema, {
        name: '',
        email: 'nope',
        password: 'short-secret'.slice(0, 5),
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ status: 400, message: 'Invalid request' });
      const details = (err as HttpError).details as Record<string, string[]>;
      expect(Object.keys(details).sort()).toEqual(['email', 'name', 'password']);
      expect(JSON.stringify(details)).not.toContain('short');
    }
  });

  it('treats a missing body as an empty object and keys root issues as "_"', () => {
    expect(() => parse(loginRequestSchema, undefined)).toThrow(HttpError);
    try {
      parse(
        loginRequestSchema.refine(() => false, 'Nope'),
        { email: 'a@b.test', password: 'x' },
      );
    } catch (err) {
      expect((err as HttpError).details).toEqual({ _: ['Nope'] });
    }
  });
});

describe('isDuplicateKey', () => {
  it('recognizes MongoDB duplicate-key errors only', () => {
    expect(isDuplicateKey({ code: 11000 })).toBe(true);
    expect(isDuplicateKey({ code: 11001 })).toBe(false);
    expect(isDuplicateKey(new Error('x'))).toBe(false);
    expect(isDuplicateKey(null)).toBe(false);
    expect(isDuplicateKey('11000')).toBe(false);
  });
});

describe('errorHandler', () => {
  const handle = (err: unknown) => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response & {
      status: ReturnType<typeof vi.fn>;
    };
    const log = { error: vi.fn() };
    errorHandler(err, { log } as unknown as Request, res, vi.fn() as NextFunction);
    return { status: res.status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0], log };
  };

  it('answers HttpErrors with their status, message and details', () => {
    expect(handle(badRequest('Invalid request', { email: ['Required'] }))).toMatchObject({
      status: 400,
      body: { error: 'Invalid request', details: { email: ['Required'] } },
    });
    expect(handle(notFound()).body).toEqual({ error: 'Not found' });
  });

  it('keeps exposed client errors from libraries (e.g. body too large)', () => {
    expect(
      handle(Object.assign(new Error('request entity too large'), { status: 413, expose: true })),
    ).toMatchObject({ status: 413, body: { error: 'request entity too large' } });
  });

  it('answers malformed JSON with 400', () => {
    const err = Object.assign(new SyntaxError('Unexpected token'), { body: '{' });
    expect(handle(err)).toMatchObject({ status: 400, body: { error: 'Malformed JSON body' } });
  });

  it('hides everything else behind a logged 500', () => {
    const err = new Error('secret internals');
    const out = handle(err);
    expect(out).toMatchObject({ status: 500, body: { error: 'Internal server error' } });
    expect(out.log.error).toHaveBeenCalledWith({ err }, 'Unhandled request error');
    expect(handle(Object.assign(new Error('x'), { status: 400 })).status).toBe(500);
    expect(handle(Object.assign(new Error('x'), { status: 503, expose: true })).status).toBe(500);
  });
});
