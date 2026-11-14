import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(import.meta.dirname, '../src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

describe('layering', () => {
  const controllersAndModels = [...walk(join(src, 'routes')), ...walk(join(src, 'modules'))];

  it('controllers and models never reach raw MongoDB collections (only the data layer does)', () => {
    expect(controllersAndModels.length).toBeGreaterThan(5);
    const offenders = controllersAndModels
      .filter((f) => /\.collection\s*[(<]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f));
    expect(offenders).toEqual([]);
  });

  it('every source module has unit tests', () => {
    const tested = walk(join(import.meta.dirname))
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const entryPoints = new Set([
      'server.ts',
      'types.ts',
      'context.ts',
      'scripts/seed-super-admin.ts',
      'scripts/seed-showcase.ts',
      'scripts/memory.ts',
      'scripts/showcase-data.ts',
    ]);
    const untested = walk(src)
      .map((f) => relative(src, f))
      .filter((f) => !entryPoints.has(f))
      .filter((f) => !tested.includes(`src/${f.replace(/\.ts$/, '.js')}'`));
    expect(untested).toEqual([]);
  });
});
