// Delete ALL tenant sites from the engine DB (plus their pages/posts/leads via
// cascade). Every row in this DB is a test/demo tenant — the WordPress sites
// (thecrowndentalclinic.com etc.) live in WordPress, not here. Prints what it
// removed, then verifies 0 rows remain.
import fs from 'node:fs';

const raw = fs.readFileSync('.engine-secrets.local', 'utf8');
const g = (k) => raw.match(new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`))[1];
const SB = g('SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=representation' };

async function list(table, sel = 'id,slug') {
  const r = await fetch(`${SB}/rest/v1/${table}?select=${encodeURIComponent(sel)}&limit=100`, { headers: H });
  if (!r.ok) throw new Error(`GET ${table} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function del(table, q) {
  const r = await fetch(`${SB}/rest/v1/${table}?${q}`, { method: 'DELETE', headers: H });
  if (!r.ok && r.status !== 204) throw new Error(`DELETE ${table}${q} -> ${r.status} ${await r.text()}`);
  return r.status === 200 ? r.json() : [];
}

const sites = await list('sites', 'id,slug,status');
console.log(`sites found: ${sites.length}`);
for (const s of sites) console.log(`  - ${s.slug} (${s.status})`);

if (!sites.length) {
  console.log('nothing to delete.');
} else {
  // Explicitly clear dependents first (cascade should handle it, but be loud).
  for (const t of ['leads', 'posts', 'pages']) {
    const rows = await del(t, `site_id=in.(${sites.map((s) => s.id).join(',')})`);
    console.log(`deleted ${rows.length} ${t}`);
  }
  // Then the sites themselves.
  for (const s of sites) {
    const r = await fetch(`${SB}/rest/v1/sites?id=eq.${s.id}`, { method: 'DELETE', headers: H });
    if (!r.ok && r.status !== 204) console.log(`  FAILED to delete ${s.slug}: ${r.status} ${await r.text()}`);
    else console.log(`deleted site ${s.slug}`);
  }
}

// Verify.
const after = await list('sites');
const posts = await list('posts');
const pages = await list('pages', 'id');
console.log(`\nVERIFY -> sites: ${after.length}, posts: ${posts.length}, pages: ${pages.length}`);