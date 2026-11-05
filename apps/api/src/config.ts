import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  MONGO_DB_NAME: z.string().min(1).default('homepact'),
});

export type Config = {
  env: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  mongoUri: string;
  mongoDbName: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    mongoUri: e.MONGO_URI,
    mongoDbName: e.MONGO_DB_NAME,
  };
}
