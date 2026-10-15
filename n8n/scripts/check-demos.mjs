// Check the two demo tenants: does the row exist, is status honest, how many
// pages, and do those pages carry compiled CSS and motion components?
import fs from 'node:fs';

const raw = fs.readFileSync('.engine-secrets.local', 'utf8');
const g = (k) => raw.match(new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`))[1];
const SB = g('SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function q(path) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const sites = await q('sites?select=slug,status,domain,niche,design_genome&order=created_at.desc&limit=6');
console.log('=== most recent sites ===');
for (const s of sites) {
  const dg = s.design_genome || {};
  console.log(
    `${(s.slug || '?').padEnd(26)} ${String(s.status).padEnd(9)} ${(s.niche || '').padEnd(18)} ` +
      `${dg.shell_archetype || '?'} / ${dg._design_skill || 'no-skill'}`
  );
}

for (const slug of ['meridian-property', 'ledgerline-tax']) {
  const rows = await q(`sites?slug=eq.${slug}&select=id,status`);
  if (!rows.length) {
    console.log(`\n[${slug}] not written yet`);
    continue;
  }
  const { id, status } = rows[0];
  console.log(`\n=== ${slug} === id=${id.slice(0, 8)} status=${status}`);
  const pages = await q(
    `pages?site_id=eq.${id}&select=slug,length(compiled_css),length(sections::text)&order=slug`
  );
  console.log(`pages: ${pages.length}`);
  let motion = 0;
  let empty = 0;
  for (const p of pages) {
    const css = Number(p.length || 0);
    // sections is jsonb; fetch the text to look for motion component names
    const body = await q(`pages?site_id=eq.${id}&slug=eq.${encodeURIComponent(p.slug)}&select=sections::text`);
    const txt = body[0]?.sections || '';
    const hasMotion = /ScrollProgress|Reveal|Parallax|StatCounter|TiltCard|StickyScene|Marquee/.test(txt);
    if (hasMotion) motion++;
    if (css === 0) empty++;
    console.log(
      `  ${p.slug.padEnd(24)} css=${String(css).padStart(6)}b  sections=${String(p.length || 0).padStart(5)}  ` +
        `motion=${hasMotion ? 'YES' : 'no'}`
    );
  }
  console.log(`  -> ${motion}/${pages.length} pages use motion; ${empty} empty CSS`);
}