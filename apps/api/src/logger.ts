import { pino, type Logger } from 'pino';

export type { Logger };

/** Removes access-key values from URLs before they reach the logs. */
export const redactUrl = (url: string | undefined): string | undefined =>
  url?.replace(/([?&](?:key|token)=)[^&#]*/gi, '$1[REDACTED]');

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.key',
  'req.body.refreshToken',
  'req.query.key',
];

/** JSON logs in production, pino-pretty elsewhere. */
export const createLogger = ({ env, level }: { env: string; level: string }): Logger =>
  pino({
    level,
    base: { service: 'homepact-api', env },
    redact: REDACT_PATHS,
    ...(env !== 'production' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l' } },
    }),
  });
