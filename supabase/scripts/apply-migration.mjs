/**
 * Applies the multi-tenant schema migration to Supabase.
 *
 * Credentials come from the environment, never from argv - a password in argv is
 * visible in the process list and in shell history.
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD=... node supabase/scripts/apply-migration.mjs [--dry-run]
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(here, '..', 'migrations', '001_multi_tenant_schema.sql');

const dryRun = process.argv.includes('--dry-run');

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('SUPABASE_DB_PASSWORD is required.');
  process.exit(2);
}

// Port 5433 is the Supavisor pooler (verified open from this host); 5432 is not
// exposed. The pooler needs the tenant-qualified user for this project ref.
const config = {
  host: process.env.SUPABASE_DB_HOST ?? '213.199.62.248',
  port: Number(process.env.SUPABASE_DB_PORT ?? 5433),
  user: process.env.SUPABASE_DB_USER ?? 'postgres',
  password,
  database: process.env.SUPABASE_DB_NAME ?? 'postgres',
  // The pooler on this host speaks PLAIN TCP - it answers "The server does not
  // support SSL connections" to any TLS attempt, so ssl:false is required, not
  // merely convenient. Set SUPABASE_DB_SSL=require if that ever changes.
  ssl: process.env.SUPABASE_DB_SSL === 'require' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 20000,
  statement_timeout: 120000,
};

const sql = await readFile(migrationPath, 'utf8');

if (dryRun) {
  console.log(`[DRY RUN] Would execute ${sql.length} bytes of SQL against ${config.host}:${config.port}/${config.database} as ${config.user}`);
  console.log(`[DRY RUN] Statements: ${(sql.match(/;/g) ?? []).length} semicolons`);
  process.exit(0);
}

const client = new pg.Client(config);

try {
  await client.connect();
  console.log(`[INFO] Connected to ${config.host}:${config.port}/${config.database}`);

  const version = await client.query('select version() as v');
  console.log(`[INFO] ${String(version.rows[0].v).slice(0, 60)}`);

  // Run the whole migration in ONE transaction: the schema is interdependent
  // (tables -> view -> unique index -> triggers), and a partial apply would leave
  // the engine reading a table that does not exist.
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('commit');
    console.log('[OK] Migration committed.');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }

  // Verify the objects actually exist rather than trusting the exit code.
  const tables = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('sites','pages','posts','leads')
      order by table_name`
  );
  const views = await client.query(
    `select table_name from information_schema.views
      where table_schema = 'public' and table_name = 'v_design_ledger'`
  );
  const indexes = await client.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and indexname = 'uniq_sites_niche_structure'`
  );
  const triggers = await client.query(
    `select tgname from pg_trigger where not tgisinternal and tgname like 'trg_%' order by tgname`
  );

  console.log('');
  console.log(`TABLES  (${tables.rowCount}): ${tables.rows.map((r) => r.table_name).join(', ')}`);
  console.log(`VIEWS   (${views.rowCount}): ${views.rows.map((r) => r.table_name).join(', ')}`);
  console.log(`INDEXES (${indexes.rowCount}): ${indexes.rows.map((r) => r.indexname).join(', ')}`);
  console.log(`TRIGGERS(${triggers.rowCount}): ${triggers.rows.map((r) => r.tgname).join(', ')}`);

  const ok = tables.rowCount === 4 && views.rowCount === 1 && indexes.rowCount === 1;
  console.log('');
  console.log(ok ? '[PASS] Schema is in place.' : '[FAIL] Expected 4 tables, 1 view, 1 index.');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}