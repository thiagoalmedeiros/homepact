import type { ApiError } from '@homepact/shared';
import type { ErrorRequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { ERRORS } from '../messages.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ApiError['details'],
  ) {
    super(message);
  }
}

export const badRequest = (
  msg: string = ERRORS.http.invalidRequest,
  details?: ApiError['details'],
) => new HttpError(400, msg, details);
export const unauthorized = (msg: string = ERRORS.http.authenticationRequired) =>
  new HttpError(401, msg);
export const forbidden = (msg: string = ERRORS.http.forbidden) => new HttpError(403, msg);
export const notFound = (msg: string = ERRORS.http.notFound) => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
export const unprocessable = (msg: string) => new HttpError(422, msg);

/** Parses a request body with a shared zod schema; invalid input → 400 with field errors. */
export const parse = <S extends ZodType>(schema: S, input: unknown): z.output<S> => {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      (details[key] ??= []).push(issue.message);
    }
    throw badRequest(ERRORS.http.invalidRequest, details);
  }
  return result.data;
};

export const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.message, ...(err.details && { details: err.details }) };
    res.status(err.status).json(body);
    return;
  }
  const status = (err as { status?: unknown }).status;
  if (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    (err as { expose?: boolean }).expose
  ) {
    res.status(status).json({ error: (err as Error).message } satisfies ApiError);
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: ERRORS.http.malformedJson } satisfies ApiError);
    return;
  }
  req.log.error({ err }, 'Unhandled request error');
  res.status(500).json({ error: ERRORS.http.internal } satisfies ApiError);
};
