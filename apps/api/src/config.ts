import { normalizeOrigin } from '@homepact/shared';

export interface AppConfig {
  env: string;
  port: number;
  logLevel: string;
  platformAdminOrigin: string;
  jwtSecret: string;
  mongo: { uri: string; dbName: string };
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const loadConfig = (): AppConfig => {
  const env = process.env['NODE_ENV'] ?? 'development';
  const jwtSecret =
    env === 'production'
      ? required('JWT_SECRET')
      : (process.env['JWT_SECRET'] ?? 'dev-only-secret');
  if (env === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
  return {
    env,
    port: Number(process.env['API_PORT'] ?? 3000),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    platformAdminOrigin: normalizeOrigin(
      process.env['PLATFORM_ADMIN_ORIGIN'] ?? 'http://localhost:4300',
    ),
    jwtSecret,
    mongo: {
      uri: required('MONGO_URI'),
      dbName: process.env['MONGO_DB_NAME'] ?? 'homepact',
    },
  };
};
