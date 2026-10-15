// Nav repair: the sitemap agent drafts 15-20 pages and builds the nav from that
// full plan, but the site-builder writes the site row (and its nav) BEFORE any
// page exists. If the run is interrupted - or any single page salvages - the nav
// still advertises pages that were never written, so the primary CTA is a 404.
//
// Two changes:
//  1. `pruneNavToPages` filters nav hrefs down to the slugs that actually exist.
//  2. `repairExistingNavs` runs it across every tenant and PATCHes the rows.
//
// Read-modify-write, dry-run by default. Pass --apply to write.

const DRY = !process.argv.includes('--apply');

const cfg = JSON.parse(
  require('node:fs').readFileSync(
    require('node:path').join(process.cwd(), '.engine-secrets.local'),
    'utf8'
  )
);
const SB = cfg.SUPABASE_URL;
const KEY = cfg.SUPABASE_SERVICE_ROLE_KEY;
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const q = async (p) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${await r.text()}`);
  return r.json();
};

/** Strips leading/trailing slashes so '/about' and 'about' compare equal. */
function canonSlug(href) {
  return String(href ?? '')
    .replace(/^https?:\/\/[^/]+/, '') // drop an absolute URL to a path
    .replace(/[#?].*$/, '') // drop hash/query
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * Keeps only the nav entries whose target page exists.
 * Home ('/' or '') is always kept. A nav entry pointing at an anchor on an
 * existing page (e.g. '/about#team') is kept when the page exists.
 */
function pruneNavToPages(nav, pageSlugs) {
  const has = new Set(pageSlugs.map(canonSlug));
  has.add(''); // the home page is stored as ''

  const keep = (item) => {
    const slug = canonSlug(item.href);
    if (slug === '') return true;
    const [path, hash] = item.href.split('#');
    return has.has(canonSlug(path)) && (!hash || has.has(canonSlug(path)));
  };

  const items = (nav?.items ?? []).filter(keep);
  const footer = (nav?.footer ?? []).filter(keep);
  return {
    navigation: { items, footer },
    removed: (nav?.items ?? []).length - items.length + (nav?.footer ?? []).length - footer.length,
  };
}

const sites = await q('sites?select=id,slug,navigation&order=created_at.desc');
console.log(`${DRY ? '[DRY RUN]' : '[APPLY]'} ${sites.length} tenant(s)\n`);

let fixed = 0;
for (const s of sites) {
  const pages = await q(`pages?site_id=eq.${s.id}&select=slug`);
  const before = s.navigation ?? {};
  const { navigation, removed } = pruneNavToPages(before, pages.map((p) => p.slug));

  if (removed === 0) {
    console.log(`OK    ${s.slug}: nav fully backed by pages (${navigation.items.length} items)`);
    continue;
  }

  fixed++;
  const missing = [...(before.items ?? []), ...(before.footer ?? [])]
    .filter((i) => {
      const [path] = String(i.href).split('#');
      const slug = canonSlug(path);
      return slug !== '' && !pages.map((p) => canonSlug(p.slug)).includes(slug);
    })
    .map((i) => i.href);

  console.log(`FIX   ${s.slug}: dropping ${removed} dead nav entry(ies) -> ${missing.join(', ')}`);
  if (!DRY) {
    const r = await fetch(`${SB}/rest/v1/sites?id=eq.${s.id}`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ navigation }),
    });
    if (!r.ok) throw new Error(`PATCH ${s.slug} -> ${r.status} ${await r.text()}`);
  }
}
console.log(`\n${DRY ? 'would fix' : 'fixed'} ${fixed} tenant(s).`);