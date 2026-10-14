// Proves the empty-page guard against the EXACT inputs that produced blank pages
// in execution 120885, plus the fan-out/status logic added with it.
//
// WHY: the two blank pages were only found by querying Postgres after the run -
// the workflow reported success. These assertions run the real emitted jsCode
// with the real payload shapes, so the fix is proven before another 6-minute run.
//
// Usage: node test-salvage-logic.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowFile = path.join(here, '..', 'workflows', 'nextjs-multi-tenant-site-builder.json');
const workflow = JSON.parse(readFileSync(workflowFile, 'utf8'));

const codeOf = (name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`no node named "${name}"`);
  return node.parameters.jsCode;
};

/** Builds the n8n sandbox globals a Code node sees: $input and $(). */
function runNode(name, { inputs, lookups }) {
  const source = codeOf(name);
  const context = {
    $input: { all: () => inputs, first: () => inputs[0] },
    $: (nodeName) => {
      const items = lookups[nodeName];
      if (!items) throw new Error(`(${'$'})('${nodeName}') was never executed`);
      return { all: () => items, first: () => items[0] };
    },
  };
  const fn = new Function('$input', '$', source);
  return fn(context.$input, context.$);
}

/* ---------------------------------------------------------------- fixtures */
const SLUGS = ['/', 'about', 'services/root-canal', 'services/dental-implants', 'contact'];

const blueprints = SLUGS.map((slug, i) => ({
  json: {
    slug,
    title: `Page ${i}`,
    business_name: 'Test Clinic',
    city: 'Pune',
    genome: { shell_archetype: 'bento-modular', color_mode: 'light-tinted', rhythm: 'even-flow' },
  },
}));

/* =========================================================== Assemble Valid Page */
console.log('=== Assemble Valid Page ===');

// The real failure: two agent items were {"error":"..."} — an error envelope,
// NOT {output: ''}. An empty message is valid MDX, so the old code published blank.
const agentWithErrors = [
  { json: { output: '```mdx\n<H1>Home</H1>\n```' } },
  { json: { output: '```mdx\n<H1>About</H1>\n```' } },
  { json: { error: 'The service failed to process your request' } },
  { json: { error: 'The service failed to process your request' } },
  { json: { output: '```mdx\n<H1>Contact</H1>\n```' } },
];
const gatesAllValid = SLUGS.map(() => ({
  json: { valid: true, css: '.x{color:red}', cssBytes: 13, warnings: [] },
}));

const assembled = runNode('Assemble Valid Page', {
  inputs: gatesAllValid,
  lookups: { 'Build Page Blueprints': blueprints, 'Page Architect Agent': agentWithErrors },
});

assert.equal(assembled.length, 5, 'must emit one row per page');
const bySlug = Object.fromEntries(assembled.map((item) => [item.json.slug, item.json]));

// The two pages that were blank MUST now be flagged, not silently published.
for (const slug of ['services/root-canal', 'services/dental-implants']) {
  const page = bySlug[slug];
  assert.equal(page.salvaged, true, `${slug} must be salvaged when the agent errored`);
  assert.ok(page.compile_error.includes('The service failed'), `${slug} must record the agent error`);
  assert.equal(page.sections[0].mdx, '_Content for this page requires review._', `${slug} must get the placeholder`);
  assert.notEqual(page.sections[0].mdx.length, 0, `${slug} must never be an empty string`);
  // The renderer reads ONLY section.mdx (PageSection has no `md` field), so a
  // salvaged page written as {md: ...} would render as an empty section.
  assert.equal(page.sections[0].md, undefined, `${slug} must not use the unrenderable "md" key`);
}
for (const slug of ['/', 'about', 'contact']) {
  assert.equal(bySlug[slug].salvaged, false, `${slug} must NOT be salvaged`);
  assert.ok(bySlug[slug].sections[0].mdx.includes('<H1>'), `${slug} must keep real content`);
  assert.ok(!bySlug[slug].sections[0].mdx.includes('```'), `${slug} must have its fence stripped`);
}
console.log('[ok] error envelopes become placeholders; real pages keep their MDX');

// An empty-but-well-formed output is ALSO unpublishable.
const assembledEmpty = runNode('Assemble Valid Page', {
  inputs: gatesAllValid,
  lookups: {
    'Build Page Blueprints': blueprints,
    'Page Architect Agent': SLUGS.map(() => ({ json: { output: '' } })),
  },
});
assert.equal(
  assembledEmpty.filter((item) => item.json.salvaged === true).length,
  5,
  'empty output must be salvaged on every page'
);
console.log('[ok] empty agent output is salvaged, never stored as a blank page');

// The gate rejecting a block is a third path to salvage.
const assembledRejected = runNode('Assemble Valid Page', {
  inputs: [{ json: { valid: false, error: 'unbalanced braces' } }, ...gatesAllValid.slice(1)],
  lookups: {
    'Build Page Blueprints': blueprints,
    'Page Architect Agent': SLUGS.map(() => ({ json: { output: '```mdx\n<H1>x</H1>\n```' } })),
  },
});
assert.equal(assembledRejected[0].json.salvaged, true, 'a gate rejection must salvage the page');
assert.ok(assembledRejected[0].json.compile_error.includes('unbalanced'), 'the gate error must be recorded');
console.log('[ok] a compile-gate rejection salvages the page');

/* ============================================================ Decide Site Status */
console.log('');
console.log('=== Decide Site Status ===');

const request = { json: { domain: 'x.example.com', slug: 'x', status: 'live', preview_subdomain: 'x.sites.test' } };
const siteRow = { json: { id: 'site-uuid-1' } };

const lookupFor = (pages) => ({
  'Upsert Site': [siteRow],
  'Normalize Site Request': [request],
  'Merge Page Results': pages,
});

const unhealthy = runNode('Decide Site Status', { inputs: [siteRow], lookups: lookupFor(assembled) });
assert.equal(unhealthy.length, 1, 'must emit exactly one item, not one per page');
assert.equal(unhealthy[0].json.healthy, false, 'a salvaged page makes the site unhealthy');
assert.equal(unhealthy[0].json.status, 'preview', 'an unhealthy site must NOT be live');
assert.equal(unhealthy[0].json.pages_salvaged, 2, 'must count the salvaged pages');
assert.deepEqual(
  unhealthy[0].json.salvaged_slugs,
  ['services/root-canal', 'services/dental-implants'],
  'must name which pages need review'
);
console.log('[ok] a site with blank pages is downgraded to preview and reports which pages');

const healthyPages = assembled.map((item) => ({
  json: { ...item.json, salvaged: false, sections: [{ mdx: '<H1>ok</H1>' }] },
}));
const healthy = runNode('Decide Site Status', { inputs: [siteRow], lookups: lookupFor(healthyPages) });
assert.equal(healthy[0].json.healthy, true, 'all-good pages are healthy');
assert.equal(healthy[0].json.status, 'live', 'a healthy site with a domain goes live');
console.log('[ok] an all-good site stays live');

// NO DOMAIN is still preview, even when every page is perfect.
const noDomain = runNode('Decide Site Status', {
  inputs: [siteRow],
  lookups: {
    'Upsert Site': [siteRow],
    'Normalize Site Request': [{ json: { ...request.json, status: 'preview' } }],
    'Merge Page Results': healthyPages,
  },
});
assert.equal(noDomain[0].json.status, 'preview', 'no custom domain means preview');
console.log('[ok] a healthy site without a custom domain stays preview');

/* ====================================================== executeOnce placement */
console.log('');
console.log('=== executeOnce placement ===');
for (const name of ['Seed Cornerstone Blogs', 'Revalidate Tenant', 'Finalize Site Status']) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `${name} must exist`);
  assert.equal(node.executeOnce, true, `${name} must set executeOnce at the TOP level`);
  assert.equal(node.parameters.executeOnce, undefined, `${name} must not nest executeOnce in parameters`);
}
console.log('[ok] batch-level nodes set executeOnce top-level (n8n ignores it inside parameters)');

/* ============================================ blog seeding is gated on health */
const gated = workflow.connections['Site Healthy?'];
assert.ok(gated?.main?.[0]?.some((e) => e.node === 'Seed Cornerstone Blogs'), 'healthy branch seeds');
assert.ok(gated?.main?.[1]?.some((e) => e.node === 'Revalidate Tenant'), 'unhealthy branch skips seeding');
console.log('[ok] blog seeding is gated behind the health check');

console.log('');
console.log(`[PASS] all assertions passed`);