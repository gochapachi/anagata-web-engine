// Does every nav href resolve to a real page row? A nav entry pointing at a
// page that was never written is a 404 in the primary CTA - exactly what the
// audit found (/contact in the nav, 404 in the browser).
import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync('.engine-secrets.local', 'utf8'));
const KEY = cfg.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const q = async (p) => {
  const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/${p}`, { headers: H });
  return r.json();
};

const sites = await q('sites?select=id,slug,navigation');
for (const s of sites) {
  const pages = await q(`pages?site_id=eq.${s.id}&select=slug`);
  const pageSlugs = new Set(pages.map((p) => p.slug));
  const nav = s.navigation?.items ?? [];
  const footer = s.navigation?.footer ?? [];
  const allNav = [...nav, ...footer];

  console.log(`=== ${s.slug} (${pages.length} pages) ===`);
  console.log(`  page slugs: ${[...pageSlugs].join(', ')}`);
  for (const item of allNav) {
    const href = item.href.replace(/^\/+/, '').replace(/\/+$/, '');
    const isHome = href === '';
    const present = isHome ? pageSlugs.has('') || pageSlugs.has('/') : pageSlugs.has(href);
    console.log(`  ${present ? 'OK  ' : 'MISS'} nav -> ${item.href}  (${item.label})`);
  }
  console.log();
}