import { normalizeOrigin } from '@homepact/shared';
import { loadConfig } from '../config.js';
import { ensureIndexes } from '../data/indexes.js';
import { runMigrations } from '../data/migrations.js';
import { connectDatabase } from '../db.js';
import { createLogger } from '../logger.js';
import { seedShowcase, seedSuperAdmin, showcaseSummary } from './seed.js';

const list = (value: string | undefined, fallback: string) =>
  (value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

const config = loadConfig();
const logger = createLogger({ env: config.env, level: config.logLevel });
const password = process.env['SEED_DEMO_PASSWORD'] ?? 'Showcase2026!';
const showcaseOrigins = list(process.env['SHOWCASE_ORIGINS'], 'http://localhost:4200');
const northwindOrigins = list(process.env['SECOND_TENANT_ORIGINS'], 'http://127.0.0.1:4200');

const database = await connectDatabase(config.mongo, logger);
await ensureIndexes(database.db);
await runMigrations(database.db);
await seedSuperAdmin(database.db, {
  email: process.env['SEED_ADMIN_EMAIL'] ?? 'admin@platform.demo',
  password: process.env['SEED_ADMIN_PASSWORD'] ?? password,
});
if (process.env['SEED_SHOWCASE'] === 'false') {
  await database.close();
  process.stdout.write('Showcase seeding disabled (SEED_SHOWCASE=false); super-admin ready.\n');
  process.exit(0);
}
const result = await seedShowcase(database.db, {
  showcaseOrigins,
  northwindOrigins,
  northwindLogoUrl: `${northwindOrigins[0]}/demo/northwind-logo.svg`,
  password,
});
await database.close();

process.stdout.write(
  showcaseSummary(result, {
    showcaseOrigins,
    secondOrigin: northwindOrigins[0]!,
    platformOrigin: config.platformAdminOrigin,
    platformEmail: process.env['SEED_ADMIN_EMAIL'] ?? 'admin@platform.demo',
    password,
  }) + '\n',
);
