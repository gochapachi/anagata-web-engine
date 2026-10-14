/**
 * Proves the anti-sameness rule is enforced by the DATABASE, not just by the
 * application code.
 *
 * The engine refuses duplicate designs in `pickStructure`, but a direct insert, a
 * replayed workflow or a manual fix could bypass that. `uniq_sites_niche_structure`
 * is the backstop: the same (niche, shell, nav, colour) cannot exist twice. This
 * script asserts that index actually rejects a duplicate, then cleans up after
 * itself - it leaves no rows behind.
 *
 * Usage: SUPABASE_DB_PASSWORD=... node supabase/scripts/verify-anti-sameness.mjs
 */

import pg from 'pg';

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('SUPABASE_DB_PASSWORD is required.');
  process.exit(2);
}

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST ?? '213.199.62.248',
  port: Number(process.env.SUPABASE_DB_PORT ?? 5433),
  user: process.env.SUPABASE_DB_USER ?? 'postgres',
  password,
  database: process.env.SUPABASE_DB_NAME ?? 'postgres',
  ssl: false,
});

const GENOME = {
  shell_archetype: 'bento-modular',
  nav_topology: 'command-bar',
  color_mode: 'dark-ink',
  fonts: { heading: 'Syne', body: 'Karla' },
};

const insertSite = (slug, genome) =>
  client.query(
    `insert into public.sites (slug, domain, preview_subdomain, niche, city, design_genome)
     values ($1, $2, $3, 'dental-clinic', 'Pune', $4)`,
    [slug, `${slug}.test`, `${slug}.sites.test`, genome]
  );

let failures = 0;
const check = (label, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!passed) failures += 1;
};

try {
  await client.connect();

  await client.query(`delete from public.sites where slug like 'verify-%'`);

  // 1. First insert of the combination is accepted.
  await insertSite('verify-a', GENOME);
  check('first insert of a design is accepted', true);

  // 2. The identical combination on the same niche must be rejected.
  let blocked = false;
  let message = '';
  try {
    await insertSite('verify-b', GENOME);
  } catch (error) {
    blocked = true;
    message = error.message;
  }
  check('duplicate design is REJECTED by the unique index', blocked, blocked ? message.slice(0, 90) : 'it was accepted');
  if (message) {
    check('rejection names the anti-sameness index', /uniq_sites_niche_structure/.test(message));
  }

  // 3. Differing on ONE axis must be accepted - the index is not over-broad.
  await insertSite('verify-c', { ...GENOME, color_mode: 'paper-ink' });
  check('a design differing on colour mode is accepted', true);

  await insertSite('verify-d', { ...GENOME, shell_archetype: 'warm-organic' });
  check('a design differing on shell is accepted', true);

  // 4. A different niche may reuse the combination.
  await client.query(
    `insert into public.sites (slug, domain, preview_subdomain, niche, city, design_genome)
     values ('verify-e', 'verify-e.test', 'verify-e.sites.test', 'law-firm', 'Pune', $1)`,
    [GENOME]
  );
  check('the same design on a different niche is accepted', true);

  // 5. The ledger view the workflow reads must expose the flats.
  // 4 rows, not 5: verify-b was correctly REJECTED above, so it never existed.
  const ledger = await client.query(
    `select slug, shell_archetype, nav_topology, color_mode, structure_signature
       from public.v_design_ledger where slug like 'verify-%' order by slug`
  );
  check('v_design_ledger returns the rows', ledger.rowCount === 4, `${ledger.rowCount} rows`);
  check(
    'v_design_ledger exposes a composite structure_signature',
    ledger.rows.every((row) => (row.structure_signature ?? '').split('|').length === 4)
  );

  console.log('');
  console.table(ledger.rows.map(({ slug, shell_archetype, color_mode, structure_signature }) => ({
    slug,
    shell_archetype,
    color_mode,
    structure_signature,
  })));

  // 6. updated_at trigger must actually fire.
  const before = await client.query(`select updated_at from public.sites where slug = 'verify-a'`);
  await client.query(`update public.sites set city = 'Mumbai' where slug = 'verify-a'`);
  const after = await client.query(`select updated_at from public.sites where slug = 'verify-a'`);
  check(
    'trg_sites_touch updates updated_at',
    new Date(after.rows[0].updated_at) > new Date(before.rows[0].updated_at)
  );
} catch (error) {
  console.error(`[ERROR] ${error.message}`);
  failures += 1;
} finally {
  // Never leave smoke rows in a production database.
  try {
    const removed = await client.query(`delete from public.sites where slug like 'verify-%'`);
    console.log(`\ncleanup: removed ${removed.rowCount} verification rows`);
    const remaining = await client.query('select count(*)::int as n from public.sites');
    console.log(`sites table now holds ${remaining.rows[0].n} row(s)`);
  } catch {
    /* connection already gone */
  }
  await client.end().catch(() => {});
}

console.log(failures === 0 ? '\n[PASS] Anti-sameness is enforced at the database level.' : `\n[FAIL] ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);