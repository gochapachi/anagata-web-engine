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
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'workflows');

/** Credential reused from the existing workflows: the working Gemini/FreeLLM path. */
const GEMINI_CREDENTIAL = { openAiApi: { id: 'vIlI3yqZbj1qnCvG', name: 'Gemini' } };
const GEMINI_MODEL = 'gemini-argon';

/**
 * Runtime configuration for the generated workflows.
 *
 * LITERAL, NOT `$env`: this n8n sets N8N_BLOCK_ENV_ACCESS_IN_NODE=true, which
 * blocks `$env` in node expressions, so `={{ $env.ENGINE_URL }}` would fail at
 * runtime. The values are inlined instead (option B).
 *
 * Secrets come from the gitignored `.engine-secrets.local` (written by
 * scripts/write-workflow-config.mjs) so they never enter argv, shell history or
 * the conversation. Non-secret endpoints have defaults.
 *
 * IMPORTANT: this puts the Supabase service-role key in the workflow definition.
 * Anyone with n8n editor access can already read environment variables the
 * workflows use, so this is not a new exposure - but it IS a reason to keep n8n
 * editor access restricted. Documented in docs/DEPLOYMENT-RUNBOOK.md.
 */
import { readFileSync as readConfigFile, existsSync as configExists } from 'node:fs';

const CONFIG_PATH = path.join(here, '..', '..', '.engine-secrets.local');

function loadRuntimeConfig() {
  const defaults = {
    ENGINE_URL: 'https://sites.anagataitsolutions.in',
    SUPABASE_URL: 'https://supabase.anagataitsolutions.in',
    SITES_BASE_DOMAIN: 'sites.anagataitsolutions.in',
    N8N_WEBHOOK_BASE: 'https://n8n.anagataitsolutions.in/webhook',
    ENGINE_COMPILE_SECRET: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    ENGINE_REVALIDATE_SECRET: '',
  };

  if (!configExists(CONFIG_PATH)) return defaults;

  const file = JSON.parse(readConfigFile(CONFIG_PATH, 'utf8'));
  // Only pick the keys we know about, so a stray field cannot leak into a URL.
  const merged = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (typeof file[key] === 'string' && file[key].length) merged[key] = file[key];
  }
  return merged;
}

const RUNTIME = loadRuntimeConfig();

const ENGINE_URL = RUNTIME.ENGINE_URL;
const SUPABASE_REST = `${RUNTIME.SUPABASE_URL}/rest/v1`;
const SUPABASE_KEY = RUNTIME.SUPABASE_SERVICE_ROLE_KEY;
const REVALIDATE_SECRET = RUNTIME.ENGINE_REVALIDATE_SECRET;
const COMPILE_SECRET = RUNTIME.ENGINE_COMPILE_SECRET;
const SITES_BASE_DOMAIN = RUNTIME.SITES_BASE_DOMAIN;
/** Same value, but safe to interpolate into generated jsCode strings. */
const SITES_BASE_DOMAIN_LITERAL = RUNTIME.SITES_BASE_DOMAIN;
const N8N_WEBHOOK_BASE = RUNTIME.N8N_WEBHOOK_BASE;

/** Warn loudly rather than emitting a workflow that will fail on first call. */
if (!SUPABASE_KEY) {
  console.warn(
    '[WARN] SUPABASE_SERVICE_ROLE_KEY is empty. Run scripts/write-workflow-config.mjs first,\n' +
      '       or the generated workflows will send unauthenticated Supabase requests.'
  );
}
if (!REVALIDATE_SECRET) {
  console.warn('[WARN] ENGINE_REVALIDATE_SECRET is empty; cache revalidation will 401.');
}

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

/**
 * Node id, max 36 chars.
 *
 * HARD CONSTRAINT, discovered the expensive way: n8n stores nodeId in a
 * varchar(36) column, and activating a workflow inserts one row per node into
 * workflow_publication_trigger_status. Any longer id makes the INSERT fail with
 * "value too long for type character varying(36)" and n8n retries forever
 * (upstream issue #40847). An earlier version put the node NAME into the middle
 * of a fake UUID, which produced 45-66 char ids and broke every activation.
 *
 * Now a real 36-char UUID: 8-4-4-4-12 hex. The suffix becomes a stable hash so
 * ids stay deterministic across regenerations - n8n treats a changed id as a
 * different node, and stable ids keep deployments idempotent.
 */
function id(suffix) {
  const hash = createHash('sha1').update(String(suffix)).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    '8' + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
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
  executeOnce = false,
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
      // TOP-LEVEL node property, NOT a field inside `parameters`. Putting it in
      // parameters is silently ignored by n8n, which is what let 'Seed Cornerstone
      // Blogs' fire once per page (5x) after a 5-page fan-out in execution 120885.
      ...(executeOnce ? { executeOnce: true } : {}),
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
  // n8n only evaluates {{ ... }} when the value STARTS WITH '='. Without it the
  // field is treated as a literal string and the LLM receives raw
  // "{{ $json.title }}" - it then replies asking for the variables to be filled
  // in, which is exactly what execution 120854 returned for 3 of 5 pages.
  // Prefixing '=' makes n8n resolve the expressions per item, so a 5-item
  // fan-out produces 5 correctly-prompted calls.
  const prompt = text.startsWith('=') ? text : `=${text}`;

  return {
    parameters: {
      promptType: 'define',
      text: prompt,
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

/**
 * Connection edge.
 *
 * `connectionType` MUST match the kind of socket being wired, not always 'main':
 * an `ai_languageModel` connection whose entry says `type: 'main'` is accepted on
 * import, validates clean, but n8n then reports the target's required input as
 * unconnected and REFUSES TO ACTIVATE the workflow. Verified against the live
 * instance: the existing working workflow types its model edge
 * `{"node":"AI Agent","type":"ai_languageModel","index":0}`.
 *
 * Defaults to 'main' so existing main-path edges are unchanged.
 */
const edge = (name, index = 0, connectionType = 'main') => ({
  node: name,
  type: connectionType,
  index,
});

/* =========================================================================
 * WORKFLOW 1 - Next.js Multi-Tenant Site Builder (v1)
 * =======================================================================*/

resetPositions();
const siteBuilderNodes = [
  webhookNode({ name: 'Webhook - Create Next.js Site', path: 'nextjs-site-generator-v2' }),

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
  : slug + '.' + '${SITES_BASE_DOMAIN_LITERAL}';

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
      preview_subdomain: slug + '.' + '${SITES_BASE_DOMAIN_LITERAL}',
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
    // The MDX is handed to the compiler via JSON.stringify rather than a chain
    // of regex .replace() calls inside an expression: a page body is full of
    // quotes, backslashes and newlines, and hand-rolled escaping produced
    // invalid JSON that the gate rejected. JSON.stringify is correct by
    // construction. The compiler tolerates the ```mdx fence itself.
    jsonBody: `={{ JSON.stringify({ mdxBlocks: [ String($json.output ?? $json.text ?? '') ] }) }}`,
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
    jsCode: `// The compile gate rejected this page's MDX. This node does NOT block the run: a
// tenant with one imperfect page is better than no tenant at all, and the site
// is created with status 'preview' so nothing goes public unreviewed.
//
// What it does guarantee: the page is stored as PLAIN TEXT, never as broken JSX.
// Broken JSX in the database would 500 a live page later.
//
// It maps over EVERY page, matching the one-row-per-page contract of
// 'Assemble Valid Page'. Using .first() here would salvage a single page and
// silently discard the other four.
const gates = $input.all();
const pages = $('Build Page Blueprints').all();
const agents = $('Page Architect Agent').all();

if (!gates.length) throw new Error('No gate results on the salvage branch.');

// Strips the fence and neutralises anything that looks like JSX so the stored
// content is inert markdown rather than markup the renderer might execute.
function inert(raw) {
  return String(raw ?? '')
    .replace(/^\\s*\\x60{3}mdx\\s*/i, '')
    .replace(/\\s*\\x60{3}\\s*$/i, '')
    .replace(/<\\/?[A-Za-z][^>]*>/g, '')
    .replace(/\\{\\{?[\\s\\S]*?\\}\\}?/g, '')
    .trim();
}

return gates.map((item, i) => {
  const gate = item.json;
  const page = pages[i]?.json ?? {};
  const agent = agents[i]?.json ?? {};
  const body = inert(agent.output ?? agent.text ?? '');

  return {
    json: {
      ...page,
      salvaged: true,
      compile_error: String(gate.error ?? 'unknown compile error').slice(0, 500),
      sections: [{ mdx: body.length > 120 ? body : '_Content for this page requires review._', anchor: 'content' }],
      compiled_css: '',
      mdx_ok: false,
    },
  };
});`,
  }),

  codeNode({
    name: 'Assemble Valid Page',
    jsCode: `// Turns each validated MDX block into a pages-row shape: ONE ROW PER PAGE.
//
// Why a map and not .first(): Code nodes preserve item order, and the agent
// fans out one item per blueprint, so the gate results, the blueprints and the
// agent outputs all line up by index. Using .first() here collapsed a
// five-page site into a single page - execution 120787 measured exactly that
// (Build Page Blueprints 5 items in, Assemble Valid Page 1 item out), which is
// how a tenant ends up with one page instead of five.
const gates = $input.all();
const pages = $('Build Page Blueprints').all();
const agents = $('Page Architect Agent').all();

if (!gates.length) throw new Error('Compile gate returned no items.');

if (pages.length !== gates.length || agents.length !== gates.length) {
  throw new Error(
    'Fan-out counts diverged (gate=' + gates.length + ' pages=' + pages.length +
    ' agent=' + agents.length + '). Refusing to zip by index - pages would be mis-paired.'
  );
}

// Unwraps the fenced mdx block the agent is instructed to emit. Backticks are
// escaped below because this block lives inside a template literal in the
// generator - an unescaped one terminates the string and breaks the build.
function unfence(raw) {
  return String(raw ?? '')
    .replace(/^\\s*\\x60{3}mdx\\s*/i, '')
    .replace(/\\s*\\x60{3}\\s*$/i, '')
    .trim();
}

// True when an item is the agent's error envelope rather than real content.
// The agent sets onError: 'continueRegularOutput', so an LLM failure arrives as
// an ordinary item whose ONLY key is 'error'.
function isErrorItem(json) {
  if (!json || typeof json !== 'object') return false;
  const keys = Object.keys(json);
  return keys.length === 1 && keys[0] === 'error';
}

// An unrecoverable page becomes an inert 'requires review' placeholder rather
// than a blank page that still reports published: true.
//
// The key MUST be 'mdx': PageSection is {block?, props?, mdx?, anchor?} and the
// renderer reads only section.mdx (src/app/_sites/[domain]/[[...page]]/page.tsx).
// Writing {md: ...} produced a section the renderer silently skipped, so a
// salvaged page rendered empty while still being marked published.
function salvage(blueprint, reason) {
  return {
    json: {
      ...blueprint,
      salvaged: true,
      compile_error: String(reason).slice(0, 500),
      sections: [{ mdx: '_Content for this page requires review._', anchor: 'content' }],
      compiled_css: '',
      mdx_ok: false,
    },
  };
}

return gates.map((item, i) => {
  const gate = item.json;
  const page = pages[i].json;
  const agent = agents[i].json;

  if (isErrorItem(agent)) {
      return salvage(page, agent.error ?? 'agent returned an error envelope');
    }

    if (gate.valid !== true) {
      return salvage(page, gate.error ?? 'compile gate rejected this block');
    }

    const mdx = unfence(agent.output ?? agent.text ?? '');
    if (!mdx.length) {
      return salvage(page, 'agent returned empty content after unfencing');
    }

    return {
      json: {
        ...page,
        salvaged: false,
        sections: [{ mdx, anchor: 'content' }],
      compiled_css: String(gate.css ?? ''),
      css_bytes: Number(gate.cssBytes ?? 0),
      warnings: gate.warnings ?? [],
      mdx_ok: true,
    },
  };
});`,
  }),

  codeNode({
    name: 'Merge Page Results',
    jsCode: `// Converging node for the MDX IF's two branches.
//
// It must ONLY read its own input. An earlier version reached back with
// $('Salvage MDX Blocks').all(), which n8n resolves by THROWING when that node
// sits on the untaken branch of the IF - so a site with perfectly valid MDX on
// every page failed the run with "Node 'Salvage MDX Blocks' hasn't been
// executed" (execution 120787). $input is always defined: it is whichever
// branch actually produced output.
//
// Both branch assemblers emit one item per page, so passing $input through
// unchanged preserves the fan-out.
const items = $input.all();
if (!items.length) {
  throw new Error('No page output reached the merge from either MDX branch.');
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
  "preview_subdomain": {{ JSON.stringify($json.site_slug + '.' + '${SITES_BASE_DOMAIN_LITERAL}') }},
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
    "published": {{ $json.salvaged === true ? false : true }}
  }`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
      { name: 'Prefer', value: 'resolution=merge-duplicates,return=representation' },
    ],
  }),

  codeNode({
      name: 'Decide Site Status',
      jsCode: `// Downgrades a site to 'preview' when any page is salvage.
  //
  // The sites row is written BEFORE the pages exist, so 'Upsert Site' can only
  // judge by whether a custom domain was supplied - which is why execution 120885
  // stored status 'live' while two service pages were blank. This node runs after
  // the pages are known and re-decides.
  //
  // It emits exactly ONE item, so the nodes after it act on the site as a whole
  // rather than once per page.
  const site = $('Upsert Site').first().json;
  const request = $('Normalize Site Request').first().json;
  const pages = $('Merge Page Results').all();

  if (!pages.length) {
    throw new Error('No pages reached the status decision.');
  }

  const salvaged = pages.filter((item) => item.json.salvaged === true);
  // A site is only served publicly when every page has real content.
  const healthy = salvaged.length === 0;

  return [
    {
      json: {
        site_id: site.id,
        domain: request.domain,
        slug: request.slug,
        healthy,
        pages_total: pages.length,
        pages_salvaged: salvaged.length,
        // A custom domain is a request, not a permission: it cannot make a site
        // with blank pages live.
        status: healthy && request.status === 'live' ? 'live' : 'preview',
        salvaged_slugs: salvaged.map((item) => item.json.slug),
      },
    },
  ];`,
    }),

    httpNode({
      name: 'Finalize Site Status',
      method: 'PATCH',
      // Filtered PATCH so it touches exactly this tenant's row.
      url: `${SUPABASE_REST}/sites?id=eq.{{ $json.site_id }}`,
      jsonBody: `={ "status": {{ JSON.stringify($json.status) }} }`,
      headers: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'apikey', value: SUPABASE_KEY },
        { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
        { name: 'Prefer', value: 'return=representation' },
      ],
      executeOnce: true,
    }),

    ifNode({
      name: 'Site Healthy?',
      // Seeding cornerstone articles onto a site with blank pages would publish
      // blog posts pointing at dead service pages.
      leftValue: '={{ $json.healthy }}',
      rightValue: '',
    }),

    httpNode({
      name: 'Seed Cornerstone Blogs',
    method: 'POST',
    url: `${N8N_WEBHOOK_BASE}/nextjs-blog-publisher-v2`,
    // 'domain' is read from Normalize Site Request, NOT from $json: this node sits
    // after 'Upsert Pages', whose fanned-out items carry {id, site_id, slug, ...}
    // and no domain, so $json.domain was undefined and the body became
    // {"domain": undefined, ...} - invalid JSON (execution 120874).
    //
    // executeOnce: true matters just as much. Without it n8n runs this HTTP node
    // once per incoming item, so a 5-page site would seed 10 articles instead of
    // 2 - and would fire the blog publisher with a partial site.
    jsonBody: `={ "domain": {{ JSON.stringify($('Normalize Site Request').first().json.domain) }}, "count": 2 }`,
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    executeOnce: true,
  }),

  httpNode({
    name: 'Revalidate Tenant',
    method: 'POST',
    url: `${ENGINE_URL}/api/revalidate`,
    // Same fix: domain comes from the request node, and the call runs once.
    // executeOnce also stops 5 redundant revalidations of one tenant.
    jsonBody: `={ "domain": {{ JSON.stringify($('Normalize Site Request').first().json.domain) }}, "type": "site" }`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'x-revalidate-secret', value: REVALIDATE_SECRET },
    ],
    executeOnce: true,
  }),

  codeNode({
    name: 'Build Site Response',
    jsCode: `// Builds the webhook response object.
//
// This is a Code node rather than an expression on the Respond node on purpose:
// a multi-line JSON literal inside a Respond node's expression field is easy to
// get wrong (an unbalanced \`{{\` fails validation at runtime, not at save time),
// and the proven pattern in this codebase is Respond-with \`={{ $json }}\`.
const request = $('Normalize Site Request').first().json;
const pages = $('Merge Page Results').all();

return [
  {
    json: {
      status: 'created',
      slug: request.slug,
      domain: request.domain,
      preview_url: 'https://' + request.preview_subdomain,
      pages_generated: pages.length,
      pages_salvaged: pages.filter((item) => item.json.salvaged === true).length,
      design: pages.length
        ? {
            shell: pages[0].json.genome.shell_archetype,
            nav: pages[0].json.genome.nav_topology,
            color_mode: pages[0].json.genome.color_mode,
            rhythm: pages[0].json.rhythm,
          }
        : null,
    },
  },
];`,
  }),

  respondNode({
    name: 'Respond - Site Created',
    bodyExpression: '={{ $json }}',
  }),
];

/* =========================================================================
 * WORKFLOW 2 - Next.js Multi-Tenant Blog Publisher (v1)
 * =======================================================================*/

resetPositions();
const blogNodes = [
  webhookNode({ name: 'Webhook - Publish Next.js Blog', path: 'nextjs-blog-publisher-v2' }),

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

// The origin value decides the exit path at the end of the run: the webhook lane
// must respond to its caller, the scheduled lane must loop to the next site. Set
// here because this is the only node that knows which trigger fired.
const origin = fromWebhook ? 'webhook' : 'schedule';

return [
  {
    json: {
      domain,
      origin,
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
// The origin value is carried forward so the exit branch can tell lanes apart.
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
    // Same JSON.stringify fix as the site builder's gate: a full article full of
    // quotes and newlines cannot be escaped by hand reliably.
    jsonBody: `={{ JSON.stringify({ mdxBlocks: [ String($json.output ?? $json.text ?? '') ] }) }}`,
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
    jsCode: `// Converging node for the blog MDX IF's two branches.
//
// Reads ONLY its own input: reaching back with $('Salvage Blog MDX').all() would
// throw on every run where the article compiled, because that node lives on the
// untaken branch of the IF. Same defect as Merge Page Results.
const items = $input.all();
if (!items.length) throw new Error('No blog output reached the merge from either MDX branch.');
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
    bodyExpression: '={{ $json }}',
  }),

  codeNode({
    name: 'Build Blog Response',
    jsCode: `const post = $('Prepare Post Row').first().json;
return [
  {
    json: {
      status: $('Merge Blog Results').first().json.salvaged ? 'published_unverified' : 'published',
      domain: post.domain,
      slug: post.slug,
      url: 'https://' + post.domain + '/blog/' + post.slug,
      title: post.title,
      words: $('Merge Blog Results').first().json.word_count ?? null,
      revalidated: true,
    },
  },
];`,
  }),

  ifNode({
    name: 'Route After Publish',
    // The scheduled lane must loop to the next site; the webhook lane must
    // respond once. Responding from INSIDE the loop would emit one webhook
    // response per site and end the loop early, so the branch happens here.
    leftValue: '={{ $json.origin }}',
    rightValue: 'schedule',
    operator: { type: 'string', operation: 'equals' },
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
    // The site's status is decided only AFTER the pages are known, and blog seeding
    // is gated on page health. Branch 0 (healthy) seeds; branch 1 (unhealthy) skips
    // seeding and goes straight to revalidation.
    'Upsert Pages': { main: [[edge('Decide Site Status')]] },
    'Decide Site Status': { main: [[edge('Finalize Site Status')]] },
    'Finalize Site Status': { main: [[edge('Site Healthy?')]] },
    'Site Healthy?': {
      main: [[edge('Seed Cornerstone Blogs')], [edge('Revalidate Tenant')]],
    },
    'Seed Cornerstone Blogs': { main: [[edge('Revalidate Tenant')]] },
    'Revalidate Tenant': { main: [[edge('Build Site Response')]] },
    'Build Site Response': { main: [[edge('Respond - Site Created')]] },
  'Model - Gemini Argon': {
    ai_languageModel: [[edge('Page Architect Agent', 0, 'ai_languageModel')]],
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
  'Revalidate Tenant Blog': { main: [[edge('Build Blog Response')]] },
  'Build Blog Response': { main: [[edge('Route After Publish')]] },
  // Exit branch. TRUE (origin=schedule) loops back to complete the iteration -
  // without this the fan-out would publish one site and stop after the first.
  // FALSE (origin=webhook) falls through to the single Respond node. The branch
  // lives here rather than on the Respond node so a scheduled run never responds.
  'Route After Publish': {
    main: [[edge('Loop Live Sites')], [edge('Respond - Blog Published')]],
  },
  'Model - Gemini Argon Blog': {
    ai_languageModel: [[edge('Blog Author Agent', 0, 'ai_languageModel')]],
  },
};

/* The site builder uses its own model node name so both files are independent. */
siteBuilderNodes.push(lmNode({ name: 'Model - Gemini Argon' }));
blogNodes.push(lmNode({ name: 'Model - Gemini Argon Blog' }));

/* =========================================================================
 * Emit
 * =======================================================================*/

const siteBuilder = {
  name: 'Anagata Next.js Multi-Tenant Site Builder (v2)',
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
  name: 'Anagata Next.js Multi-Tenant Blog Publisher (v2)',
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
  // An LLM agent's prompt is only interpolated by n8n when the field STARTS WITH
  // '='. Without it the agent receives the literal text "{{ $json.title }}" and
  // replies asking for the variables - which is what execution 120854 returned
  // for 3 of its 5 pages. Hard requirement, checked here.
  for (const node of definition.nodes) {
    if (!/langchain\.agent/.test(node.type ?? '')) continue;
    const prompt = node.parameters?.text;
    if (typeof prompt !== 'string' || !prompt.length) {
      throw new Error(`${file}: agent "${node.name}" has no text prompt`);
    }
    if (!prompt.startsWith('=')) {
      throw new Error(
        `${file}: agent "${node.name}" prompt does not start with '=' - n8n will send raw ` +
          '{{ ... }} to the LLM instead of resolving it'
      );
    }
  }
  console.log(`[ok] ${file}: agent prompts are expressions (leading '=')`);

  // executeOnce is a TOP-LEVEL node property. Placed inside `parameters` n8n
  // ignores it silently, and a node after a fan-out then fires once per item -
  // which is how 'Seed Cornerstone Blogs' fired 5x for a 5-page site
  // (execution 120885) and would have seeded 10 articles instead of 2.
  for (const node of definition.nodes) {
    if (node.parameters?.executeOnce !== undefined) {
      throw new Error(
        `${file}: "${node.name}" has executeOnce inside parameters - n8n ignores it there; ` +
          'it must be a top-level node property'
      );
    }
  }
  console.log(`[ok] ${file}: executeOnce is never misplaced inside parameters`);

  // An HTTP body may only read a field from ITS OWN input item ($json). Reading
  // $json.<field> when the predecessor does not emit that field evaluates to the
  // literal undefined and n8n rejects the body with "The value in the JSON Body
  // field is not valid JSON" - execution 120874, where Seed Cornerstone Blogs
  // read $json.domain from an Upsert Pages item that carries only
  // {id, site_id, slug, title, ...}.
  //
  // The fix pattern is to reach into a node that really has the field, e.g.
  // $('Normalize Site Request').first().json.domain.
  const emittedFields = {
    'Upsert Pages': ['id', 'site_id', 'slug', 'title', 'seo_meta', 'sections', 'compiled_css', 'published', 'created_at', 'updated_at'],
    'Upsert Site': ['id', 'slug', 'domain', 'preview_subdomain', 'niche', 'city', 'business_info', 'design_genome', 'navigation', 'seo_global', 'status', 'created_at', 'updated_at'],
    'Upsert Post': ['id', 'site_id', 'domain', 'slug', 'title', 'excerpt', 'content_mdx', 'reading_time_mins', 'published', 'created_at', 'updated_at'],
    'Expand Pages For Upsert': ['site_id', 'slug', 'title', 'business_name', 'city', 'sections', 'compiled_css', 'salvaged', 'seo_description'],
    // Field lists are what each node ACTUALLY emits. A missing entry makes the
    // guard cry wolf, so they are transcribed from the emitting node's return
    // value - e.g. Prepare Post Row does return compiled_css (line ~1278).
    'Prepare Post Row': ['site_id', 'domain', 'slug', 'title', 'excerpt', 'content_mdx', 'compiled_css', 'category', 'tags', 'author', 'seo_title', 'meta_description', 'focus_keyword', 'reading_time_mins'],
  };

  for (const node of definition.nodes) {
    const body = node.parameters?.jsonBody;
    if (typeof body !== 'string') continue;

    const predecessor = Object.entries(definition.connections).find(([, outputs]) =>
      Object.values(outputs).some((branches) =>
        branches.some((branch) => branch.some((edge) => edge.node === node.name))
      )
    )?.[0];
    const available = predecessor ? emittedFields[predecessor] : undefined;
    if (!available) continue;

    for (const field of [...body.matchAll(/\$json\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])) {
      if (!available.includes(field)) {
        throw new Error(
          `${file}: "${node.name}" reads $json.${field}, but its predecessor ` +
            `"${predecessor}" emits only [${available.join(', ')}] - that resolves to ` +
            'undefined and produces an invalid JSON body'
        );
      }
    }
  }
  console.log(`[ok] ${file}: every $json.<field> read is emitted by the node's predecessor`);

  console.log(`[ok] ${file}: every connection target resolves to a real node`);

  // n8n stores nodeId in varchar(36) and writes one row per node to
  // workflow_publication_trigger_status on activation. A longer id makes that
  // INSERT fail with "value too long for type character varying(36)", which n8n
  // retries in a loop forever (upstream issue #40847). Hard ceiling, checked here.
  for (const node of definition.nodes) {
    if (String(node.id).length > 36) {
      throw new Error(
        `${file}: node "${node.name}" has a ${String(node.id).length}-char id (max 36) - ` +
          'this breaks n8n activation with "value too long for type character varying(36)"'
      );
    }
  }
  console.log(`[ok] ${file}: every node id is <= 36 chars (n8n varchar limit)`);

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

  // A converging node after an IF must read ONLY its own input. Referencing a
  // sibling branch node with $('X') THROWS when that branch was not taken - so
  // the happy path (all MDX valid) is exactly the case that breaks. This is the
  // defect from execution 120787 and it is now rejected at build time.
  //
  // Comments are stripped first: these nodes carry long explanatory comments
  // that legitimately name the sibling branch while warning against reaching
  // into it, and the guard must judge the code, not the prose.
  const MERGE_NODES = /^Merge (Page|Blog) Results$/;
  const FORBIDDEN_REACH = /(Salvage|Assemble) (MDX Blocks|Valid Page|Blog MDX|Blog Post)/;
  const stripComments = (code) =>
    code
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/([^:'"`])\/\/.*$/gm, '$1');

  for (const node of definition.nodes) {
    if (!MERGE_NODES.test(node.name)) continue;
    const code = node.parameters?.jsCode;
    if (typeof code !== 'string') continue;
    const live = stripComments(code);

    if (!/\$input\.all\(\)/.test(live)) {
      throw new Error(`${file}: "${node.name}" does not read $input.all() - it must, to survive either branch`);
    }
    const reach = FORBIDDEN_REACH.exec(live);
    if (reach) {
      throw new Error(
        `${file}: "${node.name}" references "${reach[1]}" - a sibling IF branch that may never execute`
      );
    }
  }
  console.log(`[ok] ${file}: merge nodes read only their own input`);

  // Every branch of the site builder's IF must emit one item per incoming item,
  // or the per-page fan-out silently collapses to a single row downstream
  // (5 blueprints in, 1 page out - execution 120787).
  //
  // SCOPE: ONLY the page pair. The blog publisher assembles exactly ONE article
  // per webhook call, so .first() is correct there and must not be flagged.
  const PAGE_FANOUT_NODES = ['Assemble Valid Page', 'Salvage MDX Blocks'];
  if (definition.nodes.some((node) => PAGE_FANOUT_NODES.includes(node.name))) {
    for (const name of PAGE_FANOUT_NODES) {
      const node = definition.nodes.find((candidate) => candidate.name === name);
      if (!node) continue;
      const live = stripComments(node.parameters.jsCode ?? '');
      if (/\.first\(\)/.test(live)) {
        throw new Error(
          `${file}: "${name}" uses .first() and would collapse the per-page fan-out into one row`
        );
      }
      if (!/\$input\.all\(\)/.test(live)) {
        throw new Error(`${file}: "${name}" must map over $input.all() to preserve the fan-out`);
      }
    }
    console.log(`[ok] ${file}: page IF branches preserve the per-page fan-out`);
  }

  // Every `={{ ... }}` expression must CLOSE. An unbalanced `{{` saves fine and
  // only fails at runtime, so it is checked statically here. This caught the two
  // multi-line Respond bodies that were missing their trailing `}}`.
  for (const node of definition.nodes) {
    const values = [
      node.parameters?.responseBody,
      node.parameters?.jsonBody,
      node.parameters?.url,
    ].filter((value) => typeof value === 'string');

    for (const value of values) {
      const opens = (value.match(/\\{\\{/g) ?? []).length;
      const closes = (value.match(/\\}\\}/g) ?? []).length;
      if (opens !== closes) {
        throw new Error(
          `${file}: node "${node.name}" has ${opens} '{{' but ${closes} '}}' - the expression never closes`
        );
      }
    }
  }
  console.log(`[ok] ${file}: every {{ ... }} expression is balanced`);

  // A SplitInBatches node's loop output must eventually return to it, or the
  // fan-out publishes one item and silently stops.
  const loops = definition.nodes.filter((node) => /splitInBatches/i.test(node.type));
  for (const loop of loops) {
    const loopBranch = definition.connections[loop.name]?.main?.[1] ?? [];
    if (!loopBranch.length) {
      throw new Error(`${file}: "${loop.name}" has no loop output - nothing to iterate`);
    }
    const reachable = new Set([loopBranch[0].node]);
    const queue = [loopBranch[0].node];
    let returns = false;
    while (queue.length && !returns) {
      const current = queue.shift();
      for (const branch of definition.connections[current]?.main ?? []) {
        for (const target of branch) {
          if (target.node === loop.name) returns = true;
          if (!reachable.has(target.node)) {
            reachable.add(target.node);
            queue.push(target.node);
          }
        }
      }
    }
    if (!returns) {
      throw new Error(
        `${file}: "${loop.name}" is never reached again from its loop body - the fan-out will stop after one item`
      );
    }
  }
  if (loops.length) console.log(`[ok] ${file}: ${loops.length} loop(s) close back on themselves`);

    // N8N_BLOCK_ENV_ACCESS_IN_NODE=true on this instance, so any surviving $env
    // reference would fail at RUNTIME rather than at deploy. Fail the build instead
    // - a workflow that 500s its first HTTP node is worse than one that never
    // deployed. This is the guard for the option-B inlining.
    const envRefs = [...JSON.stringify(definition).matchAll(/\$env\.[A-Z_]+/g)].map((m) => m[0]);
    if (envRefs.length) {
      throw new Error(
        `${file}: found $env references (${[...new Set(envRefs)].join(', ')}) but this n8n sets ` +
          `N8N_BLOCK_ENV_ACCESS_IN_NODE=true, so they would fail at runtime. Inline the values instead.`
      );
    }
    console.log(`[ok] ${file}: no $env references (values are inlined)`);

    // Every HTTP node that talks to Supabase must carry its auth headers, or the
    // request 401s silently at runtime.
    for (const node of definition.nodes) {
      const url = node.parameters?.url;
      if (typeof url !== 'string' || !/rest\/v1/.test(url)) continue;
      const headers = node.parameters?.headerParameters?.parameters ?? [];
      const names = headers.map((h) => String(h.name).toLowerCase());
      if (!names.includes('apikey') || !names.includes('authorization')) {
        throw new Error(`${file}: Supabase node "${node.name}" is missing apikey/Authorization headers`);
      }
      const auth = headers.find((h) => String(h.name).toLowerCase() === 'authorization');
      if (!/^=Bearer \S+/.test(String(auth.value))) {
        throw new Error(`${file}: Supabase node "${node.name}" has an empty Authorization header`);
      }
    }
    console.log(`[ok] ${file}: all Supabase nodes carry auth headers`);

        // Any node with a typed input socket must have an inbound edge of THAT type.
        // An ai_languageModel/ai_tool/ai_outputParser edge whose entry says
        // `type: 'main'` imports fine and passes validation, but n8n refuses to
        // activate the workflow ("has no node connected to its required input").
        // Caught exactly that on the Page Architect Agent model node.
        const AI_INPUT_TYPES = ['ai_languageModel', 'ai_tool', 'ai_outputParser', 'ai_memory', 'ai_retriever'];
        const agentNodes = definition.nodes.filter((node) => /langchain\.agent$/.test(node.type));
        for (const agent of agentNodes) {
          const inbound = new Set();
          for (const outputs of Object.values(definition.connections)) {
            for (const [kind, branches] of Object.entries(outputs)) {
              if (!AI_INPUT_TYPES.includes(kind)) continue;
              for (const branch of branches) {
                for (const target of branch) {
                  if (target.node === agent.name && target.type === kind) inbound.add(kind);
                }
              }
            }
          }
          if (!inbound.has('ai_languageModel')) {
            throw new Error(
              `${file}: agent "${agent.name}" has no correctly-typed ai_languageModel edge; ` +
                `n8n will refuse to activate it. Check the edge's "type" field.`
            );
          }
        }
        if (agentNodes.length) {
          console.log(`[ok] ${file}: ${agentNodes.length} agent(s) have a typed ai_languageModel edge`);
        }
      }