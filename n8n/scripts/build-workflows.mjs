/**
 * Generates the two NEW n8n workflow definitions.
 *
 * Why a generator instead of hand-written JSON: both workflows embed long LLM
 * system prompts and nested PostgREST URLs. Writing those as JSON string
 * literals by hand means escaping every quote and newline correctly by eye,
 * which is how prompt text silently ends up mangled. Here they are plain
 * template literals and the JSON is produced by `JSON.stringify`.
 *
 * Run:  node n8n/scripts/build-workflows.mjs
 * Output: n8n/workflows/nextjs-multi-tenant-site-builder.json
 *         n8n/workflows/nextjs-multi-tenant-blog-publisher.json
 *
 * These are NEW workflows. The existing WordPress workflows
 * (TUPLn7UxLhQyYXi0, KEy18W9aUN0bnZTG) are never read or written by this file
 * or by the deploy script.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'workflows');

/** Credential reused from the existing workflows: the working Gemini/FreeLLM path. */
const GEMINI_CREDENTIAL = { openAiApi: { id: 'vIlI3yqZbj1qnCvG', name: 'Gemini' } };
const GEMINI_MODEL = 'gemini-argon';

/** Placeholders the deployer replaces, or that n8n resolves from env. */
const ENGINE_URL = '={{ $env.ENGINE_URL }}';
const SUPABASE_REST = '={{ $env.SUPABASE_URL }}/rest/v1';
const SUPABASE_KEY = '={{ $env.SUPABASE_SERVICE_ROLE_KEY }}';
const REVALIDATE_SECRET = '={{ $env.ENGINE_REVALIDATE_SECRET }}';
const COMPILE_SECRET = '={{ $env.ENGINE_COMPILE_SECRET }}';

let positionCounter = 0;
const positions = () => [positionCounter * 260, 0];

function nextPosition() {
  const position = positions();
  positionCounter += 1;
  return position;
}

/** Reset per workflow so each starts at x=0. */
function resetPositions() {
  positionCounter = 0;
}

function id(suffix) {
  return `a1e0c0de-${String(suffix).padStart(4, '0')}-4b1e-9f2a-8c3d5e6f7a8b`;
}

/* ---------------------------------------------------------------- helpers */

function webhookNode({ name, path: webhookPath, method = 'POST' }) {
  return {
    parameters: {
      httpMethod: method,
      path: webhookPath,
      responseMode: 'responseNode',
      options: {},
    },
    id: id(`${name}-wh`),
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: nextPosition(),
    webhookId: webhookPath,
  };
}

function scheduleNode({ name, rule }) {
  return {
    parameters: { rule: { interval: [rule] } },
    id: id(`${name}-sch`),
    name,
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: nextPosition(),
  };
}

function codeNode({ name, jsCode, mode = 'runOnceForAllItems' }) {
  return {
    parameters: { mode, jsCode },
    id: id(`${name}-code`),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: nextPosition(),
  };
}

function httpNode({
  name,
  method,
  url,
  jsonBody,
  queryParameters,
  headers,
  sendBody = method !== 'GET',
  bodyContentType = 'json',
  options = {},
}) {
  const parameters = { method, url, options };

  if (queryParameters?.length) {
    parameters.sendQuery = true;
    parameters.queryParameters = { parameters: queryParameters };
  }

  if (sendBody) {
    parameters.sendBody = true;
    parameters.specifyBody = 'json';
    parameters.bodyContentType = bodyContentType;
    parameters.jsonBody = jsonBody ?? '';
  } else {
    parameters.sendBody = false;
  }

  parameters.sendHeaders = true;
  parameters.headerParameters = { parameters: headers ?? [] };

  return {
    parameters,
    id: id(`${name}-http`),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: nextPosition(),
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'stopWorkflow',
  };
}

function ifNode({ name, leftValue, rightValue, operator = { type: 'boolean', operation: 'true' } }) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          {
            id: 'condition-1',
            leftValue,
            rightValue,
            operator,
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: id(`${name}-if`),
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: nextPosition(),
  };
}

function agentNode({ name, systemMessage, text }) {
  return {
    parameters: {
      promptType: 'define',
      text,
      options: {
        systemMessage,
        maxIterations: 2,
        returnIntermediateSteps: false,
      },
    },
    id: id(`${name}-agent`),
    name,
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: nextPosition(),
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  };
}

function lmNode({ name, model = GEMINI_MODEL }) {
  return {
    parameters: {
      model: { __rl: true, value: model, mode: 'list', cachedResultName: model },
      responsesApiEnabled: false,
      options: { temperature: 0.4 },
    },
    id: id(`${name}-lm`),
    name,
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.3,
    position: nextPosition(),
    credentials: GEMINI_CREDENTIAL,
  };
}

function respondNode({ name, bodyExpression }) {
  return {
    parameters: { respondWith: 'json', responseBody: bodyExpression, options: {} },
    id: id(`${name}-res`),
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: nextPosition(),
  };
}

function splitInBatchesNode({ name, batchSize = 1 }) {
  return {
    parameters: { batchSize, options: {} },
    id: id(`${name}-loop`),
    name,
    type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3,
    position: nextPosition(),
  };
}

/** main-output connection helper */
const main = (targets) => ({ main: [Array.isArray(targets) ? targets : [targets].filter(Boolean)] });
const edge = (name, index = 0) => ({ node: name, type: 'main', index });

/* =========================================================================
 * WORKFLOW 1 - Next.js Multi-Tenant Site Builder (v1)
 * =======================================================================*/

resetPositions();
const siteBuilderNodes = [
  webhookNode({ name: 'Webhook - Create Next.js Site', path: 'nextjs-site-generator-v1' }),

  codeNode({
    name: 'Normalize Site Request',
    jsCode: `// Validates the request and derives every identifier the rest of the run needs.
// Throws early: a malformed request must fail in 1 second, not after 20 minutes
// of LLM spend.
const body = $input.first().json.body ?? $input.first().json;

const required = ['business_name', 'niche', 'city', 'phone', 'services'];
const missing = required.filter((field) => {
  const value = body[field];
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || String(value).trim() === '';
});
if (missing.length) {
  throw new Error('Missing required field(s): ' + missing.join(', '));
}

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const slug = slugify(body.slug || body.business_name);
if (!slug) throw new Error('Could not derive a slug from business_name.');

const domain = body.custom_domain
  ? String(body.custom_domain).toLowerCase().replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '').replace(/^www\\./, '').trim()
  : slug + '.' + ($env.SITES_BASE_DOMAIN || 'sites.anagataitsolutions.in');

const services = (Array.isArray(body.services) ? body.services : String(body.services).split(','))
  .map((service) => String(service).trim())
  .filter(Boolean);

if (!services.length) throw new Error('services must contain at least one entry.');

return [
  {
    json: {
      run_id: slug + '-' + Date.now().toString(36),
      slug,
      domain,
      preview_subdomain: slug + '.' + ($env.SITES_BASE_DOMAIN || 'sites.anagataitsolutions.in'),
      niche: String(body.niche).trim(),
      city: String(body.city).trim(),
      business_name: String(body.business_name).trim(),
      phone: String(body.phone).trim(),
      whatsapp: body.whatsapp ? String(body.whatsapp).trim() : null,
      email: body.email ? String(body.email).trim() : null,
      address: body.address ? String(body.address).trim() : null,
      services,
      // Optional: an existing site to draw tone/structure cues from.
      reference_url: body.reference_url ? String(body.reference_url) : null,
      brand_notes: body.brand_notes ? String(body.brand_notes) : null,
      doctor_or_lead: body.doctor_or_lead ?? null,
      status: body.custom_domain ? 'live' : 'preview',
      started_at: new Date().toISOString(),
    },
  },
];`,
  }),

  httpNode({
    name: 'Get Design Genome',
    method: 'POST',
    url: `${ENGINE_URL}/api/genome`,
    jsonBody: `={
  "seed": {{ JSON.stringify($json.slug) }},
  "niche": {{ JSON.stringify($json.niche) }},
  "city": {{ JSON.stringify($json.city) }},
  "useLedger": true
}`,
    headers: [{ name: 'Content-Type', value: 'application/json' }],
  }),

  codeNode({
    name: 'Build Page Blueprints',
    jsCode: `// Expands ONE request item into ONE item per page to generate.
//
// Every item carries the genome so the page agent writes to the tenant's actual
// structure (grid, rhythm, shell) rather than a generic layout. This is where
// "the AI writes a bespoke site" is actually wired: the genome constrains the
// design, the agent fills it.
const request = $('Normalize Site Request').first().json;
const genomeResponse = $input.first().json;

if (!genomeResponse || !genomeResponse.genome) {
  throw new Error('Design genome service returned no genome: ' + JSON.stringify(genomeResponse).slice(0, 400));
}
if (genomeResponse.similarity_ok === false) {
  // The engine reports this only when its ledger read failed. Publishing anyway
  // would risk shipping a duplicate-looking site, which is the one thing this
  // system exists to prevent.
  throw new Error('Anti-sameness check failed: ' + JSON.stringify(genomeResponse.similarity ?? {}).slice(0, 300));
}

const genome = genomeResponse.genome;
const profile = genomeResponse.profile ?? genome._profile ?? {};

const slugify = (value) =>
  String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const lead = request.doctor_or_lead ?? null;
const leadLine = lead && lead.name ? lead.name + (lead.credentials ? ', ' + lead.credentials : '') : null;

const sharedBrief = [
  'BUSINESS: ' + request.business_name,
  'NICHE: ' + request.niche,
  'CITY: ' + request.city,
  'PHONE: ' + request.phone,
  request.address ? 'ADDRESS: ' + request.address : null,
  'SERVICES: ' + request.services.join(' | '),
  leadLine ? 'NAMED PROFESSIONAL (use for E-E-A-T, never invent other people): ' + leadLine : null,
  request.reference_url ? 'REFERENCE SITE (tone only, never copy text): ' + request.reference_url : null,
  request.brand_notes ? 'BRAND NOTES: ' + request.brand_notes : null,
].filter(Boolean).join('\\n');

const designBrief = [
  'SHELL: ' + genome.shell_archetype,
  'NAV: ' + genome.nav_topology,
  'COLOUR MODE: ' + genome.color_mode,
  'SECTION RHYTHM: ' + genome.rhythm,
  'GRID: ' + (profile.grid ?? 'unspecified'),
  'DENSITY: ' + (profile.density ?? 'balanced'),
  'SURFACE: ' + (profile.surface_treatment ?? 'unspecified'),
  'MOTION: ' + genome.motion_profile,
  'MAX SECTIONS: ' + (profile.max_sections ?? 11),
].join('\\n');

const pages = [
  {
    slug: '/',
    title: request.business_name,
    intent:
      'Home page. Lead with the single strongest local promise, then prove it. ' +
      'Sections in this order: hero, trust strip, services, proof, process, faq, booking CTA.',
    minSections: 6,
  },
  {
    slug: 'about',
    title: 'About Us',
    intent:
      'Credentials, story and facility. Cover who runs it, qualifications, years of experience, ' +
      'technology used, and why patients/clients choose it. Include the E-E-A-T authority block.',
    minSections: 4,
  },
  ...request.services.map((service) => ({
    slug: 'services/' + slugify(service),
    title: service,
    intent:
      'Dedicated local landing page for "' + service + '" in ' + request.city + '. ' +
      'Cover: what it is, who needs it, the process step by step, indicative cost table, ' +
      'recovery or timeline expectations, and 5 city-specific FAQs. Target local search intent.',
    minSections: 5,
  })),
  {
    slug: 'contact',
    title: 'Contact',
    intent:
      'Contact and booking. Opening hours, address, phone, and a booking form with a honeypot field. ' +
      'Do not invent an email or an address that was not supplied - omit what you do not know.',
    minSections: 3,
  },
];

return pages.map((page) => ({
  json: {
    run_id: request.run_id,
    slug: page.slug,
    title: page.title,
    minSections: page.minSections,
    intent: page.intent,
    domain: request.domain,
    site_slug: request.slug,
    city: request.city,
    services: request.services,
    phone: request.phone,
    business_name: request.business_name,
    genome,
    rhythm: genome.rhythm,
    design_brief: designBrief,
    shared_brief: sharedBrief,
    retry_count: 0,
  },
}));`,
  }),

  agentNode({
    name: 'Page Architect Agent',
    systemMessage: `You are a senior front-end engineer and conversion copywriter who writes ONE page of a
client website as MDX. You write real, specific, locally-relevant copy - never lorem ipsum and never
generic filler.

HARD RULES
1. OUTPUT: a single fenced block exactly like:
   \`\`\`mdx
   <section className="...">...</section>
   \`\`\`
   Nothing before or after it. No commentary, no explanation, no multiple blocks.
2. DESIGN FIDELITY: you MUST honour the supplied design brief. Use the stated grid, rhythm, density
   and surface treatment. A reader must be able to tell this page apart from another site's page.
3. COLOUR/TYPE: NEVER write hex codes, rgb(), or font names. Use the CSS variables provided:
   var(--bg-canvas) var(--bg-surface) var(--bg-contrast) var(--text-primary) var(--text-muted)
   var(--brand-primary) var(--brand-accent) var(--on-brand) var(--radius-card) var(--radius-button)
   var(--section-gap) var(--container-width) var(--display-scale)
   Use var(--font-heading) for headings and var(--font-body) for body text.
4. CLASSES: all layout classes must be written INSIDE className="..." so they are compiled. Tailwind
   arbitrary values are fine and encouraged: p-[38px], grid-cols-[1.1fr_0.9fr], text-[1.0625rem].
   NEVER nest minmax() inside grid-template-columns - browsers drop the whole declaration.
5. EXACTLY ONE <h1> for the page. Use <h2> for section headings. Every <img> needs a descriptive alt.
6. Use ONLY these interactive components, spelled exactly:
   <QuickSummary points={["...","..."]} />
   <CostComparisonTable title="..." rows={[{label,detail,price}]} />
   <FaqAccordion title="..." items={[{q,a}]} />
   <DoctorReviewedBadge name="..." credentials="..." date="..." />
   <Callout type="note|tip|warning">text</Callout>
   <InlineLeadCTA ctaText="..." service="..." phone="..." />
   Never import anything. Never use any other component.
7. FACTS: never invent awards, review counts, certifications, statistics, or staff names. Only use
   facts present in the business brief. If a fact is not given, write copy that does not need it.
8. PROSE: UK/Indian English. Concrete nouns and numbers. No "in today's fast-paced world", no
   "unlock", no "elevate", no "delve".
9. Must include a <footer> element at the end of the page content with the business name, phone and
   a copyright line.
10. Sections: write at least the requested minimum, each as its own <section> element.
11. Escape a bare "<" in prose as &lt; (e.g. "&lt; 30 minutes") or MDX will treat it as a tag.`,
    text: `Write the page "{{ $json.title }}" for this client.

PAGE BRIEF
{{ $json.intent }}

DESIGN BRIEF (shape the page around this exactly)
{{ $json.design_brief }}

CLIENT FACTS (the only facts you may state)
{{ $json.shared_brief }}

Minimum sections: {{ $json.minSections }}
Return only the fenced \`\`\`mdx block.`,
  }),

  httpNode({
    name: 'Compile Gate',
    method: 'POST',
    url: `${ENGINE_URL}/api/compile`,
    jsonBody: `={
  "mdxBlocks": [
    "{{ (($json.output || $json.text || '') + '').replace(/^\\s*\`\`\`mdx\\s*/i, '').replace(/\\s*\`\`\`\\s*$/i, '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n') }}"
  ]
}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'x-compile-secret', value: COMPILE_SECRET },
    ],
  }),

  ifNode({
    name: 'MDX Valid?',
    leftValue: '={{ $json.valid }}',
    rightValue: '',
  }),

  codeNode({
    name: 'Salvage MDX Blocks',
    jsCode: `// The compile gate rejected the MDX. This camera does NOT block the run: a
// tenant with one imperfect page is better than no tenant at all, and the site
// is created with status 'preview' so nothing goes public unreviewed.
//
// What it does guarantee: the page is stored as PLAIN TEXT, never as broken JSX.
// Broken JSX in the database would 500 a live page later.
const gate = $input.first().json;
const page = $('Build Page Blueprints').first().json;
const agentOutput = $('Page Architect Agent').first().json;
const raw = String(agentOutput.output ?? agentOutput.text ?? '');

// Strip the fence and neutralise anything that looks like JSX so the stored
// content is inert markdown rather than markup the renderer might execute.
const stripped = raw
  .replace(/^\\s*\`\`\`mdx\\s*/i, '')
  .replace(/\\s*\`\`\`\\s*$/i, '')
  .replace(/<\\/?[A-Za-z][^>]*>/g, '')
  .replace(/\\{\\{?[\\s\\S]*?\\}\\}?/g, '')
  .trim();

const body = stripped.length > 120 ? stripped : '_Content for this page requires review._';

return [
  {
    json: {
      ...page,
      salvaged: true,
      compile_error: String(gate.error ?? 'unknown compile error').slice(0, 500),
      sections: [{ md: body }],
      compiled_css: '',
      mdx_ok: false,
    },
  },
];`,
  }),

  codeNode({
    name: 'Assemble Valid Page',
    jsCode: `// Turns the validated MDX into the pages-row shape.
const gate = $input.first().json;
const page = $('Build Page Blueprints').first().json;
const agentOutput = $('Page Architect Agent').first().json;
const raw = String(agentOutput.output ?? agentOutput.text ?? '');

const mdx = raw
  .replace(/^\\s*\`\`\`mdx\\s*/i, '')
  .replace(/\\s*\`\`\`\\s*$/i, '')
  .trim();

return [
  {
    json: {
      ...page,
      salvaged: false,
      sections: [
        { mdx, anchor: 'content' },
      ],
      compiled_css: String(gate.css ?? ''),
      css_bytes: Number(gate.cssBytes ?? 0),
      warnings: gate.warnings ?? [],
      mdx_ok: true,
    },
  },
];`,
  }),

  codeNode({
    name: 'Merge Page Results',
    jsCode: `// Both branches converge here. n8n may deliver one branch's items only, so this
// node reads the batch from whichever branch actually produced output.
const validItems = $( 'Assemble Valid Page' ).all();
const salvagedItems = $( 'Salvage MDX Blocks' ).all();
const items = validItems.length ? validItems : salvagedItems;

if (!items.length) {
  throw new Error('No page output from either the valid or the salvage branch.');
}

return items.map((item) => ({ json: item.json }));`,
  }),

  httpNode({
    name: 'Upsert Site',
    method: 'POST',
    url: `${SUPABASE_REST}/sites?on_conflict=slug`,
    jsonBody: `={
  "slug": {{ JSON.stringify($json.site_slug) }},
  "domain": {{ JSON.stringify($json.domain) }},
  "preview_subdomain": {{ JSON.stringify($json.site_slug + '.' + ($env.SITES_BASE_DOMAIN || 'sites.anagataitsolutions.in')) }},
  "niche": {{ JSON.stringify($('Normalize Site Request').first().json.niche) }},
  "city": {{ JSON.stringify($json.city) }},
  "business_info": {
    "name": {{ JSON.stringify($json.business_name) }},
    "phone": {{ JSON.stringify($json.phone) }},
    "email": {{ JSON.stringify($('Normalize Site Request').first().json.email) }},
    "address": {{ JSON.stringify($('Normalize Site Request').first().json.address) }},
    "services": {{ JSON.stringify($json.services) }}
  },
  "design_genome": {{ JSON.stringify($json.genome) }},
  "navigation": { "items": [] },
  "seo_global": { "default_title": {{ JSON.stringify($json.business_name) }} },
  "status": {{ JSON.stringify($('Normalize Site Request').first().json.status) }}
}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
      { name: 'Prefer', value: 'resolution=merge-duplicates,return=representation' },
    ],
  }),

  codeNode({
    name: 'Expand Pages For Upsert',
    jsCode: `// One item per page, each carrying the site_id returned by Upsert Site.
//
// This node is load-bearing. Without it, Upsert Pages receives the SINGLE item
// Upsert Site returned and n8n runs the HTTP node exactly once - so a site would
// get one page instead of five. Emitting one item per page makes the HTTP node
// fan out correctly, and it also puts each page's own MDX and compiled CSS on
// the item so the request body never has to reach back into an earlier node.
const site = $input.first().json;
const siteId = site.id;
if (!siteId) {
  throw new Error('Upsert Site returned no row id; cannot attach pages. Response: ' + JSON.stringify(site).slice(0, 300));
}

const pages = $('Merge Page Results').all();
if (!pages.length) throw new Error('No pages available to insert.');

return pages.map((item) => {
  const page = item.json;
  return {
    json: {
      site_id: siteId,
      slug: page.slug,
      title: page.title,
      business_name: page.business_name,
      city: page.city,
      sections: page.sections,
      compiled_css: page.compiled_css || '',
      salvaged: page.salvaged === true,
      seo_description: page.title + ' in ' + page.city + ' - ' + page.business_name,
    },
  };
});`,
  }),

  httpNode({
    name: 'Upsert Pages',
    method: 'POST',
    url: `${SUPABASE_REST}/pages?on_conflict=site_id,slug`,
    // Every field is JSON.stringify'd rather than interpolated into a quoted
    // string: page MDX contains quotes, newlines and JSX, and naive
    // interpolation would produce invalid JSON and a silent 400.
    jsonBody: `={
  "site_id": "{{ $json.site_id }}",
  "slug": {{ JSON.stringify($json.slug) }},
  "title": {{ JSON.stringify($json.title) }},
  "seo_meta": {
    "title": {{ JSON.stringify($json.title + ' | ' + $json.business_name) }},
    "description": {{ JSON.stringify($json.seo_description) }}
  },
  "sections": {{ JSON.stringify($json.sections) }},
  "compiled_css": {{ JSON.stringify($json.compiled_css) }},
  "published": true
}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
      { name: 'Prefer', value: 'resolution=merge-duplicates,return=representation' },
    ],
  }),

  httpNode({
    name: 'Seed Cornerstone Blogs',
    method: 'POST',
    url: '={{ $env.N8N_WEBHOOK_BASE }}/nextjs-blog-publisher-v1',
    jsonBody: `={
  "domain": {{ JSON.stringify($json.domain) }},
  "count": 2
}`,
    headers: [{ name: 'Content-Type', value: 'application/json' }],
  }),

  httpNode({
    name: 'Revalidate Tenant',
    method: 'POST',
    url: `${ENGINE_URL}/api/revalidate`,
    jsonBody: `={ "domain": {{ JSON.stringify($json.domain) }}, "type": "site" }`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'x-revalidate-secret', value: REVALIDATE_SECRET },
    ],
  }),

  respondNode({
    name: 'Respond - Site Created',
    bodyExpression: `={{
  "status": "created",
  "slug": $('Normalize Site Request').first().json.slug,
  "domain": $('Normalize Site Request').first().json.domain,
  "preview_url": "https://" + $('Normalize Site Request').first().json.preview_subdomain,
  "pages_generated": $('Merge Page Results').all().length,
  "pages_salvaged": $('Merge Page Results').all().filter((item) => item.json.salvaged === true).length,
  "design": {
    "shell": $('Merge Page Results').first().json.genome.shell_archetype,
    "nav": $('Merge Page Results').first().json.genome.nav_topology,
    "color_mode": $('Merge Page Results').first().json.genome.color_mode,
    "rhythm": $('Merge Page Results').first().json.rhythm
  }
}`,
  }),
];

/* =========================================================================
 * WORKFLOW 2 - Next.js Multi-Tenant Blog Publisher (v1)
 * =======================================================================*/

resetPositions();
const blogNodes = [
  webhookNode({ name: 'Webhook - Publish Next.js Blog', path: 'nextjs-blog-publisher-v1' }),

  scheduleNode({
    name: 'Schedule - Daily Blog Fanout',
    rule: { field: 'hours', hoursInterval: 24 },
  }),

  httpNode({
    name: 'Get Live Sites',
    method: 'GET',
    url: `${SUPABASE_REST}/sites`,
    sendBody: false,
    queryParameters: [
      { name: 'select', value: 'id,slug,domain,niche,city,business_info' },
      { name: 'status', value: 'eq.live' },
      { name: 'limit', value: '50' },
    ],
    headers: [
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
    ],
  }),

  splitInBatchesNode({ name: 'Loop Live Sites', batchSize: 1 }),

  codeNode({
    name: 'Normalize Blog Request',
    jsCode: `// Two entry points converge here:
//   - the webhook, which carries an explicit domain (and optionally a topic)
//   - the daily schedule, whose loop item is a site row
// Both become the same shape.
const item = $input.first().json;

const fromWebhook = item.body ?? null;
const domain = String(
  (fromWebhook && fromWebhook.domain) || item.domain || ''
).toLowerCase().replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '').replace(/^www\\./, '').trim();

if (!domain) throw new Error('domain is required (or run from the schedule over live sites).');

return [
  {
    json: {
      domain,
      topic_override: fromWebhook?.topic_override ? String(fromWebhook.topic_override) : null,
      count: Math.min(Math.max(Number(fromWebhook?.count ?? 1), 1), 5),
      requested_at: new Date().toISOString(),
    },
  },
];`,
  }),

  httpNode({
    name: 'Get Tenant Context',
    method: 'GET',
    url: `${SUPABASE_REST}/sites`,
    sendBody: false,
    queryParameters: [
      { name: 'select', value: '*', },
      { name: 'domain', value: '=eq.{{ $json.domain }}' },
      { name: 'limit', value: '1' },
    ],
    headers: [
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
    ],
  }),

  codeNode({
    name: 'Check Tenant Exists',
    jsCode: `const rows = $input.all();
const site = rows[0]?.json;
if (!site || !site.id) {
  throw new Error('No tenant found for domain ' + $('Normalize Blog Request').first().json.domain);
}
const request = $('Normalize Blog Request').first().json;
return [{ json: { ...request, site } }];`,
  }),

  httpNode({
    name: 'Get Existing Posts',
    method: 'GET',
    url: `${SUPABASE_REST}/posts`,
    sendBody: false,
    queryParameters: [
      { name: 'select', value: 'slug,title,category,tags' },
      { name: 'site_id', value: '=eq.{{ $json.site.id }}' },
      { name: 'limit', value: '200' },
    ],
    headers: [
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
    ],
  }),

  codeNode({
    name: 'Choose Topics (No Duplicates)',
    jsCode: `// Topic selection is DETERMINISTIC, not LLM-driven, so a duplicate can never be
// "accidentally" chosen. It rotates service x angle and filters out any angle
// already present in the tenant's existing post titles/slugs.
const context = $('Check Tenant Exists').first().json;
const existing = $input.all().map((item) => item.json);
const site = context.site;
const services = Array.isArray(site.business_info?.services) ? site.business_info.services : [];
const city = site.city || 'the local area';

const angles = [
  { key: 'cost', label: 'Cost', title: (s) => s + ' Cost in ' + city + ': A Transparent Breakdown' },
  { key: 'process', label: 'Process', title: (s) => s + ': What Actually Happens, Step by Step' },
  { key: 'candidates', label: 'Who needs it', title: (s) => 'Do You Need ' + s + '? Signs It Is Time' },
  { key: 'aftercare', label: 'Aftercare', title: (s) => 'After ' + s + ': Recovery and Aftercare Timeline' },
  { key: 'compare', label: 'Comparison', title: (s) => s + ' vs the Alternatives: An Honest Comparison' },
  { key: 'myths', label: 'Myths', title: (s) => 'Common Myths About ' + s + ', Answered' },
];

if (!services.length) services.push('Our Services');

const existingTitles = existing.map((post) => String(post.title ?? '').toLowerCase());
const existingSlugs = existing.map((post) => String(post.slug ?? '').toLowerCase());

const slugify = (value) =>
  String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);

const candidates = [];
for (const service of services) {
  for (const angle of angles) {
    const title = angle.title(service);
    const slug = slugify(title);
    const taken =
      existingTitles.includes(title.toLowerCase()) ||
      existingSlugs.includes(slug) ||
      existingTitles.some((existingTitle) => existingTitle.includes(slugify(service)) && existingTitle.includes(angle.key));
    if (!taken) candidates.push({ service, angle: angle.key, angleLabel: angle.label, title, slug });
  }
}

const wanted = context.count || 1;
if (!candidates.length) {
  throw new Error('No unused topic remains for ' + site.domain + '. Add a service or a new angle before publishing.');
}

// Spread the picks across services rather than taking the first N of one service.
const picked = [];
const usedServices = new Set();
for (const candidate of candidates) {
  if (picked.length >= wanted) break;
  if (usedServices.has(candidate.service) && picked.length < Math.min(wanted, services.length)) continue;
  picked.push(candidate);
  usedServices.add(candidate.service);
}
for (const candidate of candidates) {
  if (picked.length >= wanted) break;
  if (!picked.includes(candidate)) picked.push(candidate);
}

return picked.map((candidate) => ({
  json: {
    ...context,
    topic: context.topic_override ?? candidate.title,
    slug: candidate.slug,
    service: candidate.service,
    angle: candidate.angleLabel,
    existing_post_titles: existing.map((post) => post.title).slice(0, 25),
    existing_post_slugs: existing.map((post) => post.slug).slice(0, 25),
  },
}));`,
  }),

  agentNode({
    name: 'Blog Author Agent',
    systemMessage: `You are an experienced health/professional-services writer producing ONE blog article in MDX
for a real business's website. You write to be read by a person deciding whether to book, and to be
quoted by an AI search engine.

HARD RULES
1. OUTPUT: a single fenced block exactly like:
   \`\`\`mdx
   <QuickSummary points={["...","..."]} />

   ## Heading

   Body text...

   <FaqAccordion items={[{q:"...",a:"..."}]} />
   \`\`\`
   Nothing before or after it. No commentary, no second block.
2. LENGTH: 1400-1900 words of body copy. Short paragraphs (2-4 sentences).
3. STRUCTURE: 5-8 <h2> sections. Use <h3> for sub-points. Never use <h1> - the page supplies it.
4. Use ONLY these components, spelled exactly:
   <QuickSummary points={["..."]} />
   <CostComparisonTable title="..." rows={[{label,detail,price}]} />
   <FaqAccordion title="..." items={[{q,a}]} />
   <DoctorReviewedBadge name="..." credentials="..." date="..." />
   <Callout type="note|tip|warning">text</Callout>
   <InlineLeadCTA ctaText="..." service="..." phone="..." />
   Never import anything. Never invent another component.
5. MUST contain, in this order: <QuickSummary>, at least 4 <h2> sections, one
   <CostComparisonTable>, one <InlineLeadCTA>, and a closing <FaqAccordion> with 5 questions.
6. INTERNAL LINKS: link to 2-4 of the supplied existing articles using markdown links, and to the
   service page /services/<service-slug> at least once.
7. FACTS: never invent statistics, study citations, awards, review counts or staff names. Describe
   clinical/professional reality in general terms instead of citing a number you were not given.
   Prices must be clearly framed as indicative ranges, never as a quote.
8. If a <DoctorReviewedBadge> is used, the name must be the one supplied in the brief. If none was
   supplied, omit the component entirely.
9. VOICE: UK/Indian English. Direct, specific, no hype. Banned phrases: "in today's fast-paced
   world", "unlock", "elevate", "delve", "game-changer", "look no further".
10. Escape a bare "<" in prose as &lt; or MDX will treat it as a tag.`,
    text: `Write the article "{{ $json.topic }}" for {{ $json.site.business_info.name }} ({{ $json.site.city }}).

TARGET SERVICE: {{ $json.service }}
ANGLE: {{ $json.angle }}

BUSINESS FACTS (the only facts you may state)
Name: {{ $json.site.business_info.name }}
Phone: {{ $json.site.business_info.phone }}
City: {{ $json.site.city }}
Services: {{ ($json.site.business_info.services || []).join(' | ') }}
Named professional: {{ $json.site.business_info.doctor_or_lead ? ($json.site.business_info.doctor_or_lead.name + ' ' + ($json.site.business_info.doctor_or_lead.credentials || '')) : 'NONE SUPPLIED - omit DoctorReviewedBadge' }}
E-E-A-T level: {{ $json.site.business_info.authority_level || 'general practitioner content' }}
Reading level: {{ $json.site.business_info.reading_level || 'plain, accessible' }}
Internal articles to link: {{ $json.existing_post_titles.join(' | ') || 'none yet' }}

Return only the fenced \`\`\`mdx block.`,
  }),

  httpNode({
    name: 'Compile Gate',
    method: 'POST',
    url: `${ENGINE_URL}/api/compile`,
    jsonBody: `={
  "mdxBlocks": [
    "{{ (($json.output || $json.text || '') + '').replace(/^\\s*\`\`\`mdx\\s*/i, '').replace(/\\s*\`\`\`\\s*$/i, '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n') }}"
  ]
}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'x-compile-secret', value: COMPILE_SECRET },
    ],
  }),

  ifNode({
    name: 'MDX Valid?',
    leftValue: '={{ $json.valid }}',
    rightValue: '',
  }),

  codeNode({
    name: 'Salvage Blog MDX',
    jsCode: `// The article failed to compile. Publish it as inert plain markdown rather than
// broken JSX: an imperfect article is recoverable, a 500 on /blog/<slug> is not.
const gate = $input.first().json;
const context = $('Choose Topics (No Duplicates)').first().json;
const agentOutput = $('Blog Author Agent').first().json;
const raw = String(agentOutput.output ?? agentOutput.text ?? '');

const stripped = raw
  .replace(/^\\s*\`\`\`mdx\\s*/i, '')
  .replace(/\\s*\`\`\`\\s*$/i, '')
  .replace(/<\\/?[A-Za-z][^>]*>/g, '')
  .trim();

const words = stripped.split(/\\s+/).filter(Boolean).length;
if (words < 400) {
  throw new Error('Salvaged article is too short to publish (' + words + ' words) and the original failed to compile: ' + String(gate.error).slice(0, 300));
}

return [
  {
    json: {
      ...context,
      content_mdx: stripped,
      compiled_css: '',
      salvaged: true,
      compile_error: String(gate.error ?? '').slice(0, 500),
      reading_time_mins: Math.max(1, Math.round(words / 220)),
    },
  },
];`,
  }),

  codeNode({
    name: 'Assemble Blog Post',
    jsCode: `const gate = $input.first().json;
const context = $('Choose Topics (No Duplicates)').first().json;
const agentOutput = $('Blog Author Agent').first().json;
const raw = String(agentOutput.output ?? agentOutput.text ?? '');

const content = raw
  .replace(/^\\s*\`\`\`mdx\\s*/i, '')
  .replace(/\\s*\`\`\`\\s*$/i, '')
  .trim();

const words = content.split(/\\s+/).filter(Boolean).length;
if (words < 500) {
  throw new Error('Article is only ' + words + ' words. Refusing to publish thin content on ' + context.domain + '.');
}

// The first paragraph of prose becomes the excerpt, with any component tags removed.
const excerpt =
  content
    .split('\\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('<') && !line.startsWith('#') && !line.startsWith('-'))
    .join(' ')
    .slice(0, 300) || context.topic;

const business = context.site.business_info ?? {};

return [
  {
    json: {
      ...context,
      content_mdx: content,
      compiled_css: String(gate.css ?? ''),
      warnings: gate.warnings ?? [],
      salvaged: false,
      excerpt,
      word_count: words,
      reading_time_mins: Math.max(1, Math.round(words / 220)),
      seo_title: context.topic.length > 60 ? context.topic.slice(0, 57) + '...' : context.topic,
      meta_description: excerpt.slice(0, 155),
      author: business.doctor_or_lead
        ? { name: business.doctor_or_lead.name, credentials: business.doctor_or_lead.credentials }
        : { name: business.name },
    },
  },
];`,
  }),

  codeNode({
    name: 'Merge Blog Results',
    jsCode: `const valid = $('Assemble Blog Post').all();
const salvaged = $('Salvage Blog MDX').all();
const items = valid.length ? valid : salvaged;
if (!items.length) throw new Error('No blog output from either branch.');
return items.map((item) => ({ json: item.json }));`,
  }),

  codeNode({
    name: 'Prepare Post Row',
    jsCode: `// Flattens the merged blog item into exactly what the insert needs, with every
// value already a plain JSON-safe scalar. The HTTP node below then JSON.stringify's
// these fields instead of interpolating raw article MDX into a quoted string -
// an article full of quotes and newlines would otherwise produce invalid JSON
// and a silent 400 from PostgREST.
const post = $input.first().json;
const site = post.site ?? {};
const business = site.business_info ?? {};

if (!site.id) throw new Error('Missing site id on the blog item.');
if (!post.content_mdx || post.content_mdx.length < 400) {
  throw new Error('Refusing to insert a thin article (' + (post.content_mdx || '').length + ' chars).');
}

return [
  {
    json: {
      site_id: site.id,
      domain: post.domain,
      slug: post.slug,
      title: post.topic,
      excerpt: post.excerpt,
      content_mdx: post.content_mdx,
      compiled_css: post.compiled_css || '',
      category: post.service,
      tags: [post.service],
      author: post.author ?? { name: business.name },
      seo_title: post.seo_title,
      meta_description: post.meta_description,
      focus_keyword: post.service + ' ' + (site.city || ''),
      reading_time_mins: post.reading_time_mins,
    },
  },
];`,
  }),

  httpNode({
    name: 'Upsert Post',
    method: 'POST',
    url: `${SUPABASE_REST}/posts?on_conflict=site_id,slug`,
    jsonBody: `={
  "site_id": "{{ $json.site_id }}",
  "slug": {{ JSON.stringify($json.slug) }},
  "title": {{ JSON.stringify($json.title) }},
  "excerpt": {{ JSON.stringify($json.excerpt) }},
  "content_mdx": {{ JSON.stringify($json.content_mdx) }},
  "compiled_css": {{ JSON.stringify($json.compiled_css) }},
  "category": {{ JSON.stringify($json.category) }},
  "tags": {{ JSON.stringify($json.tags) }},
  "author": {{ JSON.stringify($json.author) }},
  "seo_meta": {
    "seo_title": {{ JSON.stringify($json.seo_title) }},
    "meta_description": {{ JSON.stringify($json.meta_description) }},
    "focus_keyword": {{ JSON.stringify($json.focus_keyword) }}
  },
  "reading_time_mins": {{ $json.reading_time_mins }},
  "status": "published"
}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
      { name: 'Prefer', value: 'resolution=merge-duplicates,return=representation' },
    ],
  }),

  httpNode({
    name: 'Revalidate Tenant Blog',
    method: 'POST',
    url: `${ENGINE_URL}/api/revalidate`,
    jsonBody: `={
  "domain": "{{ $json.domain }}",
  "slug": "{{ $json.slug }}",
  "type": "post"
}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'x-revalidate-secret', value: REVALIDATE_SECRET },
    ],
  }),

  respondNode({
    name: 'Respond - Blog Published',
    bodyExpression: `={{
  "status": $('Merge Blog Results').first().json.salvaged ? "published_unverified" : "published",
  "domain": $('Merge Blog Results').first().json.domain,
  "slug": $('Merge Blog Results').first().json.slug,
  "url": "https://" + $('Merge Blog Results').first().json.domain + "/blog/" + $('Merge Blog Results').first().json.slug,
  "title": $('Merge Blog Results').first().json.topic,
  "words": $('Merge Blog Results').first().json.word_count ?? null,
  "revalidated": true
}`,
  }),
];

/* =========================================================================
 * Connections
 * =======================================================================*/

const siteBuilderConnections = {
  'Webhook - Create Next.js Site': { main: [[edge('Normalize Site Request')]] },
  'Normalize Site Request': { main: [[edge('Get Design Genome')]] },
  'Get Design Genome': { main: [[edge('Build Page Blueprints')]] },
  'Build Page Blueprints': { main: [[edge('Page Architect Agent')]] },
  'Page Architect Agent': { main: [[edge('Compile Gate')]] },
  'Compile Gate': { main: [[edge('MDX Valid?')]] },
  'MDX Valid?': {
    main: [[edge('Assemble Valid Page')], [edge('Salvage MDX Blocks')]],
  },
  'Assemble Valid Page': { main: [[edge('Merge Page Results')]] },
  'Salvage MDX Blocks': { main: [[edge('Merge Page Results')]] },
  'Merge Page Results': { main: [[edge('Upsert Site')]] },
  'Upsert Site': { main: [[edge('Expand Pages For Upsert')]] },
  'Expand Pages For Upsert': { main: [[edge('Upsert Pages')]] },
  'Upsert Pages': { main: [[edge('Seed Cornerstone Blogs')]] },
  'Seed Cornerstone Blogs': { main: [[edge('Revalidate Tenant')]] },
  'Revalidate Tenant': { main: [[edge('Respond - Site Created')]] },
  'Model - Gemini Argon': {
    ai_languageModel: [[edge('Page Architect Agent', 0)]],
  },
};

const blogConnections = {
  'Webhook - Publish Next.js Blog': { main: [[edge('Normalize Blog Request')]] },
  'Schedule - Daily Blog Fanout': { main: [[edge('Get Live Sites')]] },
  'Get Live Sites': { main: [[edge('Loop Live Sites')]] },
  'Loop Live Sites': {
    main: [[], [edge('Normalize Blog Request')]],
  },
  'Normalize Blog Request': { main: [[edge('Get Tenant Context')]] },
  'Get Tenant Context': { main: [[edge('Check Tenant Exists')]] },
  'Check Tenant Exists': { main: [[edge('Get Existing Posts')]] },
  'Get Existing Posts': { main: [[edge('Choose Topics (No Duplicates)')]] },
  'Choose Topics (No Duplicates)': { main: [[edge('Blog Author Agent')]] },
  'Blog Author Agent': { main: [[edge('Compile Gate')]] },
  'Compile Gate': { main: [[edge('MDX Valid?')]] },
  'MDX Valid?': { main: [[edge('Assemble Blog Post')], [edge('Salvage Blog MDX')]] },
  'Assemble Blog Post': { main: [[edge('Merge Blog Results')]] },
  'Salvage Blog MDX': { main: [[edge('Merge Blog Results')]] },
  'Merge Blog Results': { main: [[edge('Prepare Post Row')]] },
  'Prepare Post Row': { main: [[edge('Upsert Post')]] },
  'Upsert Post': { main: [[edge('Revalidate Tenant Blog')]] },
  'Revalidate Tenant Blog': { main: [[edge('Respond - Blog Published')]] },
  'Model - Gemini Argon Blog': {
    ai_languageModel: [[edge('Blog Author Agent', 0)]],
  },
};

/* The site builder uses its own model node name so both files are independent. */
siteBuilderNodes.push(lmNode({ name: 'Model - Gemini Argon' }));
blogNodes.push(lmNode({ name: 'Model - Gemini Argon Blog' }));

/* =========================================================================
 * Emit
 * =======================================================================*/

const siteBuilder = {
  name: 'Anagata Next.js Multi-Tenant Site Builder (v1)',
  nodes: siteBuilderNodes,
  connections: siteBuilderConnections,
  settings: {
    executionOrder: 'v1',
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'all',
    saveManualExecutions: true,
    executionTimeout: 1800,
    timezone: 'Asia/Kolkata',
  },
  tags: [],
};

const blogPublisher = {
  name: 'Anagata Next.js Multi-Tenant Blog Publisher (v1)',
  nodes: blogNodes,
  connections: blogConnections,
  settings: {
    executionOrder: 'v1',
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'all',
    saveManualExecutions: true,
    executionTimeout: 1800,
    timezone: 'Asia/Kolkata',
  },
  tags: [],
};

await mkdir(outDir, { recursive: true });

for (const [file, definition] of [
  ['nextjs-multi-tenant-site-builder.json', siteBuilder],
  ['nextjs-multi-tenant-blog-publisher.json', blogPublisher],
]) {
  const target = path.join(outDir, file);
  await writeFile(target, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');
  console.log(
    `[wrote] ${file}: ${definition.nodes.length} nodes, ${Object.keys(definition.connections).length} connection groups`
  );
  // A dangling connection key is the single most common cause of an import that
  // silently drops edges, so it is asserted here rather than discovered in n8n.
  const names = new Set(definition.nodes.map((node) => node.name));
  for (const [source, outputs] of Object.entries(definition.connections)) {
    if (!names.has(source)) throw new Error(`${file}: connection source "${source}" has no node`);
    for (const branches of Object.values(outputs)) {
      for (const branch of branches) {
        for (const target of branch) {
          if (!names.has(target.node)) {
            throw new Error(`${file}: "${source}" points at missing node "${target.node}"`);
          }
        }
      }
    }
  }
  console.log(`[ok] ${file}: every connection target resolves to a real node`);

  // Regression guard for the two defects that were found by reading the emitted
  // workflows rather than by importing them:
  //   1. a page/post row body containing a literal placeholder, and
  //   2. a row-writing HTTP node reading from a node other than its immediate
  //      predecessor (the reach-back pattern that pairs one site with many rows
  //      incorrectly).
  for (const node of definition.nodes) {
    const body = node.parameters?.jsonBody;
    if (typeof body !== 'string') continue;

    if (/"placeholder"|__PLACEHOLDER__/.test(body)) {
      throw new Error(`${file}: node "${node.name}" still emits a placeholder body`);
    }

    // Any $('X') reference inside a write body must be a node whose output is
    // deliberately consulted; flag the known-bad case of reaching into the
    // page-merge node while iterating rows.
    if (/Upsert (Site|Pages|Post)$/.test(node.name)) {
      const badRef = /\\$\\(\\s*['"](Merge Page Results|Merge Blog Results)['"]\\s*\\)/.exec(body);
      if (badRef) {
        throw new Error(
          `${file}: node "${node.name}" reads from "${badRef[1]}" instead of its input item`
        );
      }
    }
  }
  console.log(`[ok] ${file}: no placeholder bodies, no reach-back writes`);
}