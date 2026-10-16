// Prove the emitted "Assemble Valid Page" sanitizer works on REAL stored MDX.
//
// WHY THIS EXISTS: `node --check` on the emitted Code-node JS is necessary but
// not sufficient — it catches escaping damage, not logic. `cleaned.mdx.includes`
// parsed cleanly and threw on the first page of every run, and `dedupeH1` parsed
// cleanly while keeping one agent H1 next to the engine's, so every live page
// still shipped two. This runs the ACTUAL functions extracted from the emitted
// workflow against the ACTUAL rows that produced those pages.
//
// Regexes are safe here: this file is never emitted through the generator's
// template literal, so no transport hop eats its backslashes.
import { readFileSync } from 'node:fs';
import https from 'node:https';

const REPO = 'C:/Users/sanje/OneDrive/Desktop/Anagata Business workflows automation/anagata-web-engine';
const wf = JSON.parse(readFileSync(`${REPO}/n8n/workflows/nextjs-multi-tenant-site-builder.json`, 'utf8'));
const code = wf.nodes.find((n) => n.name === 'Assemble Valid Page').parameters.jsCode;

const start = code.indexOf('function dropTag(');
const end = code.indexOf('let cleaned = rawMdx;');
if (start === -1 || end === -1) throw new Error(`sanitizer markers not found (start=${start}, end=${end})`);
const block = code.slice(start, end);
const { dropTag, stripTagsText, isBoundary, stripPTags, demoteH1 } = new Function(
  `${block}; return { dropTag, stripTagsText, isBoundary, stripPTags, demoteH1 };`
)();
console.log(`[ok] extracted sanitizer from emitted workflow (${block.split('\n').length} lines)`);

const count = (s, tag) => {
  let n = 0;
  const lower = s.toLowerCase();
  for (let i = 0; ; ) {
    const a = lower.indexOf(`<${tag}`, i);
    if (a === -1) return n;
    if (isBoundary(lower[a + tag.length + 1])) n++;
    i = a + 1;
  }
};
// <p> sitting directly inside a heading is invalid nesting and renders the
// heading text as a paragraph — the second failure mode on the live pages.
const pInsideHeading = (s) => {
  let n = 0;
  const lower = s.toLowerCase();
  for (const h of ['h1', 'h2', 'h3']) {
    for (let i = 0; ; ) {
      const a = lower.indexOf(`<${h}`, i);
      if (a === -1) break;
      const gt = s.indexOf('>', a);
      const c = lower.indexOf(`</${h}`, gt);
      if (gt === -1 || c === -1) break;
      if (count(s.slice(gt + 1, c), 'p') > 0) n++;
      i = c + 1;
    }
  }
  return n;
};

const env = JSON.parse(readFileSync(`${REPO}/.engine-secrets.local`, 'utf8'));
const rest = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const get = (u) =>
  new Promise((res, rej) => {
    const r = https.request(new URL(u), { headers: H }, (x) => {
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => res(JSON.parse(d || 'null')));
    });
    r.on('error', rej);
    r.end();
  });

const sites = await get(`${rest}/sites?select=id,slug&slug=in.(apex-talent-partners,surya-solar-solutions)`);
const failures = [];
let pages = 0;
let dupBefore = 0;

for (const s of sites) {
  const rows = await get(`${rest}/pages?site_id=eq.${s.id}&select=slug,title,sections&order=slug.asc&limit=99`);
  for (const p of rows) {
    const raw = (p.sections || []).map((x) => x.mdx).filter(Boolean).join('\n');
    if (!raw) continue;
    pages++;

    const before = { h1: count(raw, 'h1'), header: count(raw, 'header'), footer: count(raw, 'footer'), nav: count(raw, 'nav') };
    if (before.h1 > 0) dupBefore++;

    let cleaned = raw;
    for (const tag of ['header', 'footer', 'nav']) cleaned = dropTag(tag, cleaned);
    cleaned = demoteH1(cleaned);

    const after = { h1: count(cleaned, 'h1'), header: count(cleaned, 'header'), footer: count(cleaned, 'footer'), nav: count(cleaned, 'nav') };
    const label = `${s.slug}/${p.slug || '<home>'}`;

    if (after.h1 !== 0) failures.push(`${label}: ${after.h1} <h1> left in body after demote (engine adds its own)`);
    for (const tag of ['header', 'footer', 'nav']) {
      if (after[tag] !== 0) failures.push(`${label}: <${tag}> survived chrome stripping (${after[tag]})`);
    }
    const bad = pInsideHeading(cleaned);
    if (bad > 0) failures.push(`${label}: ${bad} heading(s) still wrap a <p> (renders heading as paragraph)`);
    if (!cleaned.includes('<section')) failures.push(`${label}: sanitizer destroyed all page sections`);

    const textBefore = stripTagsText(raw).replace(/\s+/g, ' ').trim();
    const textAfter = stripTagsText(cleaned).replace(/\s+/g, ' ').trim();
    // Only chrome may be removed; the body copy must survive intact.
    if (textAfter.length < textBefore.length * 0.9) {
      failures.push(`${label}: sanitizer dropped ${(100 - (textAfter.length / textBefore.length) * 100).toFixed(0)}% of visible text`);
    }
  }
  console.log(`[..] ${s.slug}: ${rows.length} pages checked`);
}

console.log('');
console.log(`pages checked          : ${pages}`);
console.log(`pages with an agent H1 : ${dupBefore} (each was a visible duplicate next to the engine's)`);
console.log('');
if (failures.length) {
  console.log(`[FAIL] ${failures.length} sanitizer problem(s):`);
  for (const f of failures.slice(0, 25)) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('[PASS] sanitizer leaves 0 H1 / 0 header / 0 footer / 0 nav in the body, no <p> inside headings, text intact');