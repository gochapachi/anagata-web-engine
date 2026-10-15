// Diagnose the audit findings against the real DB + source. Read-only.
import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync('.engine-secrets.local', 'utf8'));
const SB = cfg.SUPABASE_URL;
const KEY = cfg.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function q(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const sites = await q('sites?select=id,slug,domain,preview_subdomain,navigation,seo_global');
console.log('=== sites ===');
for (const s of sites) {
  console.log(`${s.slug}`);
  console.log(`  domain            : ${s.domain}`);
  console.log(`  preview_subdomain : ${s.preview_subdomain}`);
  console.log(`  seo_global        : ${JSON.stringify(s.seo_global).slice(0, 160)}`);
  const nav = s.navigation ?? {};
  console.log(`  nav items         : ${(nav.items ?? []).map((i) => i.href).join(', ') || '(none)'}`);
  const pages = await q(`pages?site_id=eq.${s.id}&select=slug,title,sections&order=slug`);
  console.log(`  pages (${pages.length}): ${pages.map((p) => p.slug || '/').join(', ')}`);
  console.log();
}

// Home-page MDX forensics for the first site
const first = sites[0];
const home = await q(`pages?site_id=eq.${first.id}&slug=eq.&select=sections&limit=1`);
const mdx = home[0]?.sections?.[0]?.mdx ?? '';
console.log(`=== forensics: ${first.slug} home (${mdx.length} chars) ===`);
const checks = {
  'shell-header (agent-authored dup)': mdx.includes('shell-header'),
  '<header tag': /<header[\s>]/.test(mdx),
  '<footer tag': /<footer[\s>]/.test(mdx),
  'navbar': /<nav[\s>]/.test(mdx),
  'NaNvh': mdx.includes('NaNvh'),
  'h1 count > 1': (mdx.match(/<h1[\s>]/g) || []).length,
  'nested <p><p>': /<p[^>]*>\s*<p[\s>]/.test(mdx),
  '<img> count': (mdx.match(/<img[\s>]/g) || []).length,
  '<details> count': (mdx.match(/<details[\s>]/g) || []).length,
  'raw <table> count': (mdx.match(/<table[\s>]/g) || []).length,
  'raw phone-like digits': /\+91\s?\d{5,}/.test(mdx),
  'example.com link': mdx.includes('example.com'),
  'tel: links': (mdx.match(/tel:/g) || []).length,
  'inline style height NaN': /height:\s*NaN/.test(mdx),
};
for (const [k, v] of Object.entries(checks)) console.log(`  ${v}  ${k}`);

// The NaN line itself
const lines = mdx.split('\n');
const bad = lines.find((l) => l.includes('NaN'));
console.log(`\n  NaN line: ${bad ? bad.trim().slice(0, 120) : '(not found in a single line)'}`);
// Where StickyScene is used
const ss = mdx.match(/<StickyScene[^>]*>/g);
console.log(`  StickyScene uses: ${ss ? ss.join(' | ') : 'none'}`);
// Where the agent puts a phone string raw
const phone = mdx.match(/\+91[\d\s]{8,}/g);
console.log(`  phone strings: ${phone ? phone.slice(0, 4).join(' / ') : 'none'}`);
