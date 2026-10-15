/**
 * Compiles a page's stored MDX EXACTLY as the renderer does, and reports the real
 * error instead of the renderer's fallback.
 *
 * WHY: renderMdx() catches every compile failure and renders the raw source in a
 * <pre>, returning HTTP 200. So a broken page looks like a page full of text. The
 * only way to see the defect is to run the same compile outside that catch.
 *
 * Usage: node n8n/scripts/diagnose-mdx.mjs <site-slug> [page-slug]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, run } from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';

const siteSlug = process.argv[2] ?? 'auth-verify-dental';
const pageSlug = process.argv[3] ?? '/';
const here = path.dirname(fileURLToPath(import.meta.url));
const secrets = JSON.parse(
  readFileSync(path.join(here, '..', '..', '.engine-secrets.local'), 'utf8')
);
const H = {
  apikey: secrets.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${secrets.SUPABASE_SERVICE_ROLE_KEY}`,
};

const sites = await (
  await fetch(
    `${secrets.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/sites?select=id,slug&slug=eq.${siteSlug}`,
    { headers: H }
  )
).json();
const site = sites[0];
if (!site) {
  console.error(`no site ${siteSlug}`);
  process.exit(1);
}

const pages = await (
  await fetch(
    `${secrets.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/pages?select=slug,sections&site_id=eq.${site.id}&slug=eq.${encodeURIComponent(pageSlug)}`,
    { headers: H }
  )
).json();
const page = pages[0];
if (!page) {
  console.error(`no page ${pageSlug} on ${siteSlug}`);
  process.exit(1);
}

const sections = typeof page.sections === 'string' ? JSON.parse(page.sections) : page.sections;
console.log(`=== compiling ${siteSlug} / ${pageSlug} ===`);
console.log(`    ${sections.length} section(s)`);

let failed = 0;
for (const [i, sec] of sections.entries()) {
  const src = sec.mdx ?? '';
  console.log(`\n--- section ${i} (anchor=${sec.anchor ?? '-'}, ${src.length} chars) ---`);
  try {
    const compiled = await compile(src, {
      jsx: false,
      development: false,
      outputFormat: 'function-body',
      providerImportSource: undefined,
    });
    await run(String(compiled), { ...runtime, baseUrl: import.meta.url });
    console.log('    OK — compiles and runs');
  } catch (error) {
    failed++;
    console.log(`    FAILED: ${error.message}`);
    // Report where the compiler says the problem is, then bisect by PREFIX.
    // Testing single lines is useless for JSX (one line is never a valid element
    // on its own) — the useful question is "how many leading lines still compile".
    const pos = error.position ? ` at line ${error.position.line}, col ${error.position.column}` : '';
    console.log(`    message: ${String(error.message).split('\n')[0]}${pos}`);
    console.log('    note: the offending line is usually just BEFORE the reported position');

    const lines = src.split('\n');
    let lo = 0;
    let hi = lines.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const prefix = lines.slice(0, mid).join('\n');
      let ok = true;
      try {
        const c = await compile(prefix, { jsx: false, development: false, outputFormat: 'function-body' });
        await run(String(c), { ...runtime, baseUrl: import.meta.url });
      } catch {
        ok = false;
      }
      if (ok) lo = mid;
      else hi = mid - 1;
    }
    const badLine = lo; // 0-based index of the first line that breaks the prefix
    console.log(`    first line that breaks compilation: ${badLine + 1}`);
    for (let i = Math.max(0, badLine - 2); i <= Math.min(lines.length - 1, badLine + 2); i++) {
      console.log(`      ${String(i + 1).padStart(4)}${i === badLine ? ' >' : '  '} ${lines[i].slice(0, 100)}`);
    }
  }
}

console.log('');
console.log(failed ? `[FAIL] ${failed} section(s) failed to compile` : '[PASS] all sections compile');
process.exit(failed ? 1 : 0);