import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoBinary, MongoMemoryServer } from 'mongodb-memory-server-core';

/** The API with no Docker and no MongoDB to install: starts its own database, runs the showcase
 * seed against it, then serves the API until stopped. The database is mongod (downloaded once)
 * or, where mongod cannot be downloaded or started, the JavaScript stand-in (src/data/memory-db);
 * DB_ENGINE=mongod or DB_ENGINE=memory picks one instead of trying mongod first.
 * The data is gone on exit unless MONGO_DATA_DIR names a folder to keep it in (relative to where
 * npm was run; the seed skips what is already there). `--watch` restarts the API on change and
 * keeps the data. `--download-only` fetches the mongod binary and exits, for sandboxes that have
 * network when built but not when run. */

/** Same major as the Docker stack's `mongo:8.0` (infra/docker-compose.yml). */
const MONGO_VERSION = process.env['MONGOMS_VERSION'] ?? '8.0.26';
const args = new Set(process.argv.slice(2));

if (args.has('--download-only')) {
  const binary = await MongoBinary.getPath({ version: MONGO_VERSION });
  process.stdout.write(`mongod ${MONGO_VERSION} ready at ${binary}\n`);
  process.exit(0);
}

const dataDir = process.env['MONGO_DATA_DIR']
  ? resolve(process.env['INIT_CWD'] ?? process.cwd(), process.env['MONGO_DATA_DIR'])
  : undefined;
if (dataDir) mkdirSync(dataDir, { recursive: true });

const engine = process.env['DB_ENGINE'] ?? 'auto';
if (!['auto', 'mongod', 'memory'].includes(engine)) {
  process.stderr.write(`DB_ENGINE must be mongod or memory (or unset to try mongod first)\n`);
  process.exit(1);
}

const startMongod = async (): Promise<MongoMemoryServer | undefined> => {
  if (engine === 'memory') return undefined;
  try {
    return await MongoMemoryServer.create({
      binary: { version: MONGO_VERSION },
      ...(dataDir && { instance: { dbPath: dataDir, storageEngine: 'wiredTiger' } }),
    });
  } catch (err) {
    if (engine === 'mongod') throw err;
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(`mongod unavailable (${reason}); using the in-memory database.\n`);
    return undefined;
  }
};

const mongo = await startMongod();
/** The JavaScript database lives in each process, so the seed hands it to the API in a file. */
const memoryFile = mongo
  ? undefined
  : join(dataDir ?? tmpdir(), dataDir ? 'homepact-memory.json' : `homepact-${process.pid}.json`);
const uri = mongo ? mongo.getUri() : `memory:${memoryFile}`;
process.stdout.write(
  mongo
    ? `Database: MongoDB ${MONGO_VERSION}, ${dataDir ?? 'in memory, gone on exit'}\n`
    : `Database: in-memory (JavaScript), ${dataDir ? memoryFile : 'gone on exit'}\n`,
);

const release = async (): Promise<void> => {
  await mongo?.stop();
  if (memoryFile && !dataDir) rmSync(memoryFile, { force: true });
};
const env = { ...process.env, MONGO_URI: uri };
const ext = extname(fileURLToPath(import.meta.url));

/** Runs a sibling entry point (.ts under tsx, .js once built) with this process's Node flags. */
const run = (entry: string, flags: string[] = []): ChildProcess =>
  spawn(
    process.execPath,
    [...process.execArgv, ...flags, fileURLToPath(new URL(`${entry}${ext}`, import.meta.url))],
    { env, stdio: 'inherit' },
  );

const seed = run('./seed-showcase');
const [seedCode] = (await once(seed, 'exit')) as [number | null];
if (seedCode !== 0) {
  await release();
  process.exit(seedCode ?? 1);
}

const api = run('../server', args.has('--watch') ? ['--watch'] : []);
let stopping = false;
const stop = async (code: number): Promise<void> => {
  if (stopping) return;
  stopping = true;
  if (api.exitCode === null && api.signalCode === null) {
    api.kill('SIGTERM');
    await once(api, 'exit');
  }
  await release();
  process.exit(code);
};

api.on('exit', (code) => void stop(code ?? 0));
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
