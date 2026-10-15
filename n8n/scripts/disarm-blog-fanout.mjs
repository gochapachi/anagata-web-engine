/**
 * Disarms the daily blog fanout.
 *
 * TWO changes, both reversible:
 *
 *  1. Every tenant moves from status='live' to status='preview'. The scheduled
 *     fanout selects `status=eq.live`, so with no live tenants it has no targets.
 *     'preview' is deliberately chosen over 'suspended': fetchSite() filters
 *     `status=neq.suspended`, so preview URLs KEEP WORKING - the tenant stays
 *     viewable at <slug>.anagataitsolutions.in, it just stops being eligible for
 *     unattended publishing.
 *
 *  2. The 'Schedule - Daily Blog Fanout' node is disabled in the blog publisher,
 *     so the trigger cannot fire at all. The webhook trigger stays live, so
 *     manual publishing and site-builder seeding are unaffected.
 *
 * NOTHING IS DELETED. Reversing is a status flip plus re-enabling one node.
 *
 * Usage: node disarm-blog-fanout.mjs [--apply]
 *        (dry run without --apply)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------- credentials */
const hermesConfig = path.join(
  process.env.USERPROFILE ?? process.env.HOME,
  'AppData', 'Local', 'hermes', 'config.yaml'
);
const n8nKey = readFileSync(hermesConfig, 'utf8').match(/N8N_API_KEY:\s*(\S+)/)[1];

const secrets = JSON.parse(
  readFileSync(path.join(here, '..', '..', '.engine-secrets.local'), 'utf8')
);
const supabaseUrl = secrets.SUPABASE_URL.replace(/\/+$/, '');
const serviceKey = secrets.SUPABASE_SERVICE_ROLE_KEY;

const N8N = 'https://n8n.anagataitsolutions.in/api/v1';
const N8N_H = { 'X-N8N-API-KEY': n8nKey, Accept: 'application/json', 'Content-Type': 'application/json' };
const SB_H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to commit) ===');
console.log('');

/* --------------------------------------------------- 1. survey current state */
const sites = await (
  await fetch(`${supabaseUrl}/rest/v1/sites?select=slug,status,domain`, { headers: SB_H })
).json();

const live = sites.filter((s) => s.status === 'live');
console.log(`tenants total : ${sites.length}`);
console.log(`status=live   : ${live.length}   <- the fanout's entire target set`);
console.log(`other status  : ${sites.filter((s) => s.status !== 'live').map((s) => s.status).join(', ') || '(none)'}`);
console.log('');
console.log('live tenants that would receive unattended articles:');
for (const s of live) console.log(`   ${s.slug.padEnd(26)} ${s.domain}`);
console.log('');

/* ------------------------------------------- 2. flip live -> preview */
if (live.length) {
  if (!APPLY) {
    console.log(`[dry] would PATCH ${live.length} tenant(s) live -> preview`);
  } else {
    const res = await fetch(`${supabaseUrl}/rest/v1/sites?status=eq.live`, {
      method: 'PATCH',
      headers: { ...SB_H, Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'preview' }),
    });
    const rows = await res.json();
    if (!res.ok) {
      console.log(`[FAIL] PATCH sites -> HTTP ${res.status}: ${JSON.stringify(rows).slice(0, 200)}`);
      process.exit(1);
    }
    console.log(`[OK] ${rows.length} tenant(s) moved to 'preview'`);
    for (const r of rows) console.log(`     ${r.slug.padEnd(26)} -> ${r.status}`);
  }
} else {
  console.log('no live tenants - nothing to flip');
}

/* ------------------------------------- 3. disable the schedule trigger */
const BLOG_WF = 'rVsGpyFO4MunNndo';
const wf = await (await fetch(`${N8N}/workflows/${BLOG_WF}`, { headers: N8N_H })).json();
const scheduleNode = (wf.nodes ?? []).find((n) => /schedule/i.test(n.type) || n.name.includes('Schedule'));

console.log('');
if (!scheduleNode) {
  console.log('[WARN] no schedule node found in the blog publisher - check by hand');
} else {
  const alreadyOff = scheduleNode.disabled === true;
  console.log(`schedule node : ${scheduleNode.name}  (disabled=${scheduleNode.disabled ?? false})`);

  if (alreadyOff) {
    console.log('[OK] already disabled - nothing to do');
  } else if (!APPLY) {
    console.log('[dry] would set disabled=true on that node and PUT the workflow');
  } else {
    // Only the one field changes; everything else is echoed back untouched.
    const nextNodes = wf.nodes.map((n) =>
      n.name === scheduleNode.name ? { ...n, disabled: true } : n
    );
    const put = await fetch(`${N8N}/workflows/${BLOG_WF}`, {
      method: 'PUT',
      headers: N8N_H,
      body: JSON.stringify({
        name: wf.name,
        nodes: nextNodes,
        connections: wf.connections,
        settings: wf.settings ?? {},
      }),
    });
    const body = await put.text();
    if (!put.ok) {
      console.log(`[FAIL] PUT workflow -> HTTP ${put.status}: ${body.slice(0, 200)}`);
      process.exit(1);
    }
    const verify = await (await fetch(`${N8N}/workflows/${BLOG_WF}`, { headers: N8N_H })).json();
    const after = (verify.nodes ?? []).find((n) => n.name === scheduleNode.name);
    console.log(`[OK] schedule node disabled=${after.disabled}`);
    console.log(`     webhook trigger untouched, active=${verify.active}`);
  }
}

/* --------------------------------------------------------- 4. verify */
if (APPLY) {
  const after = await (
    await fetch(`${supabaseUrl}/rest/v1/sites?select=status&status=eq.live`, { headers: SB_H })
  ).json();
  console.log('');
  console.log(`tenants still 'live': ${after.length}   <- the fanout now targets ${after.length} site(s)`);
  console.log('');
  console.log('Preview URLs keep working: fetchSite() excludes only status=suspended.');
  console.log('To reverse: flip status back to live and set disabled=false on the node.');
}
