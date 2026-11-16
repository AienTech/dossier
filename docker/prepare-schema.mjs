import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from './tools/node_modules/pg/lib/index.js';

// A release must be safe even while the scheduled worker is asleep. Every
// container checks readiness; only one holds the release lock and migrates.
// The web server is never started against a partially migrated schema.
const toolsRoot = fileURLToPath(new URL('./tools/', import.meta.url));
const expected = (await readdir(join(toolsRoot, 'prisma/migrations'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name);
const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error('The release needs the direct PostgreSQL connection.');
const db = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
const deadline = Date.now() + 120000;
let locked = false;
try {
  await db.connect();
  while (!locked) {
    const result = await db.query("SELECT pg_try_advisory_lock(hashtextextended('hireme:release-migrate', 0)) AS locked");
    locked = result.rows[0].locked;
    if (!locked) {
      if (Date.now() >= deadline) throw new Error('Another container is still preparing the database.');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  let applied = new Set();
  try {
    const result = await db.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    applied = new Set(result.rows.map(row => row.migration_name));
  } catch (error) { if (error.code !== '42P01') throw error; }
  if (!expected.every(name => applied.has(name))) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
        cwd: toolsRoot, env: { ...process.env, DATABASE_URL: connectionString }, stdio: 'inherit', timeout: 90000,
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Database migration failed; refusing to serve this release.')));
    });
    const result = await db.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    const ready = new Set(result.rows.map(row => row.migration_name));
    if (!expected.every(name => ready.has(name))) throw new Error('The database schema is not ready.');
  }
} finally {
  // Closing the direct connection also releases the session advisory lock.
  await db.end();
}
