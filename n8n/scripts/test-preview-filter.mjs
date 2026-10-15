// Guards the PostgREST filter syntax in fetchSite's slug fallback.
//
// WHY THIS EXISTS: the fallback was written as `slug.eq.<slug>`. That is not
// PostgREST filter syntax - the parameter is silently IGNORED and the query
// returns the first row of the table. So every preview host resolved to the
// OLDEST tenant, and all ten sites rendered the same business. The HTTP request
// still returned 200 with a valid-looking site row, which is why nothing
// anywhere reported a problem.
//
// A test that only checked "fetchSite returns a site" would pass against the
// broken code. This asserts the FILTER IS EXPRESSED CORRECTLY, which is the
// property that actually failed.
//
// Usage: node n8n/scripts/test-preview-filter.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '..', '..', 'src', 'lib', 'supabase.ts'), 'utf8');

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`        ${detail}`);
  }
};

console.log('=== fetchSite filter syntax ===');

// Every PostgREST filter parameter must use the `key=op.value` form.
// The dot form (`key.op.value`) is not a filter and is ignored server-side.
const dotFormFilters = [...source.matchAll(/[?&]([a-z_]+)\.(eq|neq|gt|lt|in|is)\./g)].map(
  (m) => `${m[1]}.${m[2]}.`
);
check(
  'no dot-form PostgREST filters (they are ignored, not rejected)',
  dotFormFilters.length === 0,
  dotFormFilters.length ? `found: ${[...new Set(dotFormFilters)].join(', ')}` : ''
);

// The slug fallback must filter on slug with the equals form.
check(
  'slug fallback uses slug=eq.<value>',
  /slug=eq\.\$\{encodeURIComponent\(slug\)\}/.test(source),
  'expected `slug=eq.${encodeURIComponent(slug)}`'
);

// The primary lookup must keep filtering on BOTH domain and preview_subdomain.
check(
  'primary lookup filters domain OR preview_subdomain',
  /or=\(domain\.eq\.\$\{encoded\},preview_subdomain\.eq\.\$\{encoded\}\)/.test(source),
  'expected or=(domain.eq...,preview_subdomain.eq...)'
);

// limit=1 on both, or a mis-filter returns many rows and the first wins silently.
const limitCount = (source.match(/limit=1/g) ?? []).length;
check('both site lookups pin limit=1', limitCount >= 2, `found limit=1 ${limitCount}x`);

/* --------------------------------------------------- live evidence, if possible */
const secretsPath = path.join(here, '..', '..', '.engine-secrets.local');
let secrets = null;
try {
  secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
} catch {
  console.log('');
  console.log('  (no .engine-secrets.local - skipping the live filter check)');
}

if (secrets) {
  const H = {
    apikey: secrets.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${secrets.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const url = secrets.SUPABASE_URL.replace(/\/+$/, '');

  // Prove against the live database that the two forms behave differently. This
  // is the check that actually caught the bug.
  const rows = await (
    await fetch(`${url}/rest/v1/sites?select=slug&limit=5`, { headers: H })
  ).json();
  const a = rows[0]?.slug;
  const b = rows[1]?.slug;

  if (a && b) {
    console.log('');
    console.log('=== live behaviour (two distinct tenants) ===');
    const bad = await (
      await fetch(`${url}/rest/v1/sites?select=slug&slug.eq.${b}&limit=1`, { headers: H })
    ).json();
    const good = await (
      await fetch(`${url}/rest/v1/sites?select=slug&slug=eq.${b}&limit=1`, { headers: H })
    ).json();

    check(
      `dot form for "${b}" is IGNORED (returns "${bad[0]?.slug}", proving it is not a filter)`,
      bad[0]?.slug === a,
      `expected the unfiltered first row "${a}", got "${bad[0]?.slug}"`
    );
    check(
      `equals form for "${b}" filters correctly`,
      good[0]?.slug === b,
      `expected "${b}", got "${good[0]?.slug}"`
    );
  }
}

console.log('');
if (failures) {
  console.log(`[FAIL] ${failures} check(s) failed`);
  process.exit(1);
}
console.log('[PASS] fetchSite filters are valid PostgREST syntax');