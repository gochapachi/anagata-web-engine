// Quality check for the two demo sites: pages per site, motion-component usage,
// compiled CSS, and preview URLs.
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

const MOTION = ['ScrollProgress', 'Reveal', 'Parallax', 'StatCounter', 'TiltCard', 'StickyScene', 'Marquee'];

for (const slug of ['meridian-property-group', 'ledgerline-tax-advisors']) {
  const sites = await q(`sites?slug=eq.${slug}&select=id,status,domain,preview_subdomain,niche,design_genome`);
  if (!sites.length) {
    console.log(`\n[${slug}] NOT FOUND`);
    continue;
  }
  const s = sites[0];
  const dg = s.design_genome || {};
  console.log(`\n=== ${slug} ===`);
  console.log(`status  : ${s.status}   niche: ${s.niche}`);
  console.log(`domain  : ${s.domain}`);
  console.log(`preview : ${s.preview_subdomain}`);
  console.log(`shell   : ${dg.shell_archetype}   skill: ${dg._design_skill || '(none)'}  nav: ${dg.nav_topology}`);
  console.log(`motion  : ${dg.motion_profile}`);

  const pages = await q(`pages?site_id=eq.${s.id}&select=slug,compiled_css&order=slug`);
  console.log(`\npages (${pages.length}):`);
  let motionPages = 0;
  let emptyCss = 0;
  for (const p of pages) {
    const css = String(p.compiled_css || '').length;
    if (css === 0) emptyCss++;
    // fetch sections text for motion markers
    const body = await q(`pages?site_id=eq.${s.id}&slug=eq.${encodeURIComponent(p.slug)}&select=sections::text`);
    const txt = body[0]?.sections || '';
    const used = MOTION.filter((m) => txt.includes(m));
    if (used.length) motionPages++;
    console.log(
      `  ${p.slug.padEnd(24)} css=${String(css).padStart(6)}b  motion=${used.join(',') || 'NONE'}`
    );
  }
  console.log(`\n  -> ${motionPages}/${pages.length} pages use motion components; ${emptyCss} with empty CSS`);
  console.log(`  -> preview URL: https://${s.preview_subdomain}`);
}