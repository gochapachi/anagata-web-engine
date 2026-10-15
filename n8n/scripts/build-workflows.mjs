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

/** Model provider — FreeLLM (https://freellm.anagataitsolutions.in) via the
 *  FreeLLM n8n credential (id NexReT9zk3GuX1sO). The user changed the live
 *  model node to `auto:free_models` and asked to KEEP it: this constant is the
 *  source of truth, so regenerating the workflow can never silently revert to
 *  gemini-argon. */
const LLM_CREDENTIAL = { openAiApi: { id: 'NexReT9zk3GuX1sO', name: 'FreeLLM' } };
const LLM_MODEL = 'auto:free_models';

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
    SITES_BASE_DOMAIN: 'anagataitsolutions.in',
    N8N_WEBHOOK_BASE: 'https://n8n.anagataitsolutions.in/webhook',
    ENGINE_COMPILE_SECRET: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    ENGINE_REVALIDATE_SECRET: '',
    NINEROUTER_URL: '',
    NINEROUTER_KEY: '',
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
    allowEmptyOutput = false,
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
      // A GET that legitimately matches zero rows (a tenant's post list before its
      // first article) returns an empty array. Without this, n8n emits no items,
      // the downstream branch never runs, and the publish dies SILENTLY - which is
      // exactly how blog seeding produced nothing on a brand-new site.
      // Reads that must survive an empty result set this; writes must not, because
      // an empty write body would be a bug worth failing on.
      ...(allowEmptyOutput ? { alwaysOutputData: true } : {}),
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

function lmNode({ name, model = LLM_MODEL }) {
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
    credentials: LLM_CREDENTIAL,
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
// =========================================================================
// v3 SITE BUILDER - multi-agent orchestration
// =========================================================================
// =========================================================================
// v3 SITE BUILDER — multi-agent orchestration (fully corrected)
//
// Pipeline:
//   Webhook(v3) -> Normalize (adds research_prompt) -> Get Genome
//     -> Prepare Research Prompt (merge request+genome)
//     -> Research Agent (9router search+fetch tools) -> research brief JSON
//     -> Prepare Sitemap Prompt (merge request+genome+research_brief)
//     -> Sitemap Architect Agent -> pages[] + nav
//     -> Parse Sitemap (code) -> Build Navigation (code; fixes empty-nav bug)
//     -> Upsert Site Row (creates site up front so pages can FK)
//     -> Expand Pages (one item per page with full context)
//     -> Loop Pages (SplitInBatches, the ONLY loop)
//          body: Page Creator Agent -> Compile Gate -> MDX Valid?
//            true -> Prepare Page For Review (reattach mdx+context)
//               -> Page Quality Analyzer -> Parse Verdict -> Route Verdict
//                    pass -> Assemble Valid Page
//                    retry -> Retries Left? -> Bump Retry -> Page Creator (retry)
//               (retries exhausted -> Mark Page Salvaged)
//            false -> Mark Page Salvaged
//          -> Upsert Page -> Collect Page Results -> Loop Pages (continue)
//     loop done -> Decide Site Status (salvaged count -> live|preview)
//       -> Finalize Site Status (PATCH) -> Site Healthy? -> Revalidate Tenant
//       -> Build Site Response -> Respond
//
// n8n loop semantics relied on: inside a SplitInBatches loop, referencing the
// loop node returns the CURRENT batch item — so Prepare Page For Review and
// Bump Retry can reattach full page context without per-item bookkeeping.
// =========================================================================

/** LangChain HTTP-Request TOOL node (9router search / fetch).
 *
 * Header pitfall this exists to avoid: toolHttpRequest has SEPARATE flags for
 * sending headers vs sending a body. A node that carries `headerParameters`
 * WITHOUT `sendHeaders: true` silently drops every header, including the
 * 9router Bearer token and the Content-Type - the call reaches the API
 * unauthenticated and fails. The build guard asserts the flags. */
function toolHttpNode({
  name,
  toolDescription,
  method = 'POST',
  url,
  jsonBody,
  headers,
  placeholders = [],
}) {
  return {
    parameters: {
      toolDescription,
      method,
      url,
      sendHeaders: Boolean(headers && headers.length),
      specifyHeaders: headers && headers.length ? 'keypair' : undefined,
      parametersHeaders:
        headers && headers.length
          ? {
              values: headers.map((h) => ({
                name: h.name,
                valueProvider: 'fieldValue',
                value: h.value,
              })),
            }
          : undefined,
      sendBody: jsonBody !== undefined,
      specifyBody: jsonBody !== undefined ? 'json' : undefined,
      jsonBody,
      placeholderDefinitions:
        placeholders.length
          ? {
              values: placeholders,
            }
          : undefined,
      options: { timeout: 30000 },
    },
    id: id(`${name}-tool`),
    name,
    type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
    typeVersion: 1.1,
    position: nextPosition(),
  };
}

const NINEROUTER_URL = RUNTIME.NINEROUTER_URL || 'https://9router.anagataitsolutions.in/v1';
const NINEROUTER_KEY = RUNTIME.NINEROUTER_KEY;

const v3BuilderNodes = [];
const v3BuilderConnections = {};

/* ---- front: webhook, normalize, genome ---------------------------------- */
v3BuilderNodes.push(
  webhookNode({ name: 'Webhook - Create Next.js Site', path: 'nextjs-site-generator-v3' }),
  codeNode({
    name: 'Normalize Site Request',
    jsCode: `const body = $input.first().json.body ?? $input.first().json;

const required = ['business_name', 'niche', 'city', 'phone', 'services'];
const missing = required.filter((field) => {
  const value = body[field];
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || String(value).trim() === '';
});
if (missing.length) throw new Error('Missing required field(s): ' + missing.join(', '));

const slugify = (value) =>
  String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const slug = slugify(body.slug || body.business_name);
if (!slug) throw new Error('Could not derive a slug from business_name.');

const domain = body.custom_domain
  ? String(body.custom_domain).toLowerCase().replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '').replace(/^www\\./, '').trim()
  : slug + '.' + '${SITES_BASE_DOMAIN_LITERAL}';

const services = (Array.isArray(body.services) ? body.services : String(body.services).split(','))
  .map((service) => String(service).trim())
  .filter(Boolean);
if (!services.length) throw new Error('services must contain at least one entry.');

return [{
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
    reference_url: body.reference_url ? String(body.reference_url) : null,
    brand_notes: body.brand_notes ? String(body.brand_notes) : null,
    doctor_or_lead: body.doctor_or_lead ?? null,
    research_prompt:
      'Research ' + String(body.business_name) + ', a ' + String(body.niche) + ' in ' + String(body.city) +
      '. Services: ' + services.join(', ') +
      '. Find: what the business actually does, indicative price bands, the localities it serves, ' +
      'its competitors, and the questions clients ask. Return real, verifiable facts only.',
    started_at: new Date().toISOString(),
  },
}];`,
  }),
  httpNode({
    name: 'Get Design Genome',
    method: 'POST',
    url: `${ENGINE_URL}/api/genome`,
    jsonBody: `={{ JSON.stringify({ seed: $json.slug, niche: $json.niche, city: $json.city, useLedger: true }) }}`,
    headers: [{ name: 'Content-Type', value: 'application/json' }],
  }),
  codeNode({
    name: 'Prepare Research Prompt',
    jsCode: `// Merges the normalized request (which carries research_prompt) with the
// design genome, so the Research Agent receives both. The genome node's output
// is the genome object only, so this reattaches the request fields.
const request = $('Normalize Site Request').first().json;
const genome = $input.first().json;
return [{
  json: {
    ...request,
    genome: genome.genome,
    design_skill: String(genome.design_skill?.block ?? ''),
    shell: String(genome.genome?.shell_archetype ?? ''),
  },
}];`,
  })
);

/* ---- research agent + 9router tools -------------------------------------- */
v3BuilderNodes.push(
  toolHttpNode({
    name: 'Search Web',
    toolDescription: 'Search the web for business information, local competitors, services, and market facts.',
    method: 'POST',
    url: `${NINEROUTER_URL}/search`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Authorization', value: `Bearer ${NINEROUTER_KEY}` },
    ],
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Authorization', value: `Bearer ${NINEROUTER_KEY}` },
    ],
    placeholders: [
      { name: 'query', description: 'The search query string (e.g. business niche and city)', type: 'string' },
    ],
    jsonBody: JSON.stringify({
      model: 'tavily',
      query: '{query}',
      max_results: 5,
      search_type: 'web',
    }),
  }),
  toolHttpNode({
    name: 'Fetch Web Page',
    toolDescription: 'Fetch and read the content of a web page URL as markdown.',
    method: 'POST',
    url: `${NINEROUTER_URL}/web/fetch`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Authorization', value: `Bearer ${NINEROUTER_KEY}` },
    ],
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Authorization', value: `Bearer ${NINEROUTER_KEY}` },
    ],
    placeholders: [
      { name: 'url', description: 'The full URL of the webpage to scrape and read', type: 'string' },
    ],
    jsonBody: JSON.stringify({
      model: 'jina-reader',
      url: '{url}',
      format: 'markdown',
      max_characters: 6000,
    }),
  }),
  agentNode({
    name: 'Research Agent',
    systemMessage: `You are a business researcher for a professional-services website.
You research the business, its niche, its city and its competitors using two tools:
1. 'Search Web' — call it with the argument {"query": "<specific query — niche + city>"}
2. 'Fetch Web Page' — call it with {"url": "<page url>"} to read a page as markdown

Gather REAL facts only. NEVER invent statistics, awards, review counts, staff names, prices,
addresses or dates. If a fact is not verifiable, mark it UNKNOWN and move on.

Produce a RESEARCH BRIEF as a single fenced JSON block and nothing else:
\`\`\`json
{
  "business_overview": "what the business actually does, 1-2 sentences",
  "verified_facts": ["fact 1", "fact 2"],
  "price_bands": ["indicative band 1"] or [],
  "local_areas": ["area 1", "area 2"],
  "competitor_notes": "what competitors do well or badly",
  "common_questions": ["q1", "q2", "q3"],
  "tone_words": ["concrete", "reassuring"]
}
\`\`\`
The brief is the ONLY source of facts available to the page writers, so be thorough but honest.`,
    text: `=Research the business behind this website request and produce the JSON brief.

Request: {{ $json.research_prompt }}

Business: {{ $json.business_name }}
Niche: {{ $json.niche }}
City: {{ $json.city }}
Services: {{ JSON.stringify($json.services) }}
Reference site (tone only, never copy): {{ $json.reference_url || 'none' }}

Return ONLY the fenced \`\`\`json block.`,
  }),
  lmNode({ name: 'Model - Research' })
);

/* ---- sitemap architect + parser + nav ------------------------------------- */
v3BuilderNodes.push(
  codeNode({
    name: 'Prepare Sitemap Prompt',
    jsCode: `// The Research Agent emits {output: "<fenced json>"}. Merge that brief with the
// request + genome so the Sitemap Architect has everything in one item.
const request = $('Normalize Site Request').first().json;
const genome = $('Prepare Research Prompt').first().json;
const raw = String($input.first().json.output ?? $input.first().json.text ?? '');
const brief = raw.replace(/^\u0060\u0060\u0060[\\w-]*\\s*/, '').replace(/\\s*\u0060\u0060\u0060$/, '').trim();
let research_brief = brief;
try { research_brief = JSON.stringify(JSON.parse(brief)); } catch {}
return [{
  json: { ...request, ...genome, research_brief },
}];`,
  }),
  agentNode({
    name: 'Sitemap Architect',
    systemMessage: `You are a senior information architect building the complete sitemap and navigation for a
professional-services website.

Given the research brief, the business facts and the design genome, produce:
1. A sitemap of 15-20 pages — NEVER fewer than 15. Cover EVERY service as its own page and every
   named locality, plus: home, about (team/credentials), services hub, process, pricing,
   testimonials, FAQ, contact, and niche-appropriate pages (e.g. valuation for estate agency,
   fee schedule for a tax practice, results page for a clinic).
2. A navigation tree that reaches EVERY page. "primary" holds the 4-6 items a visitor must see
   first; "footerGroups" groups the rest. Nothing may be unreachable.

Return ONLY a single fenced JSON block:
\`\`\`json
{
  "pages": [
    { "slug": "/", "title": "...", "intent": "purpose and sections for the page writer, 2-3 sentences", "minSections": 9 }
  ],
  "nav": {
    "primary": [{ "label": "...", "href": "/..." }],
    "footerGroups": [{ "group": "...", "items": [{ "label": "...", "href": "/..." }] }]
  }
}
\`\`\`
Rules: every slug starts with "/". Every page appears in primary or a footer group. minSections is
at least 7 for every page, 8-9 for the home page. Slugs are lowercase and hyphenated.`,
    text: `=Build the sitemap and navigation for this site.

Business: {{ $json.business_name }}
Niche: {{ $json.niche }}
City: {{ $json.city }}
Services: {{ JSON.stringify($json.services) }}
Design shell: {{ $json.shell }}
Design skill rules:
{{ $json.design_skill }}

RESEARCH BRIEF (the only facts you may rely on):
{{ $json.research_brief }}

Return ONLY the fenced \`\`\`json block with "pages" and "nav".`,
  }),
  lmNode({ name: 'Model - Sitemap' }),
  codeNode({
    name: 'Parse Sitemap',
    jsCode: `// Parse the sitemap agent's fenced JSON defensively. On any failure, fall back
// to a minimal usable sitemap so a parser hiccup cannot kill the whole run.
const request = $('Normalize Site Request').first().json;
const research = $('Prepare Sitemap Prompt').first().json;

let parsed = null;
const raw = String($input.first().json.output ?? $input.first().json.text ?? '');
try {
  const clean = raw.replace(/^\u0060\u0060\u0060[\\w-]*\\s*/, '').replace(/\\s*\u0060\u0060\u0060$/, '').trim();
  parsed = JSON.parse(clean);
} catch (err) {
  parsed = {
    pages: [
      { slug: '/', title: request.business_name, intent: 'Home. Lead with the strongest local promise, then prove it.', minSections: 8 },
      { slug: '/about', title: 'About Us', intent: 'Credentials, story and team.', minSections: 7 },
      ...(Array.isArray(request.services) ? request.services : []).map((s) => ({
        slug: '/services/' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title: s,
        intent: 'Service page for ' + s + '. What it is, who needs it, process, cost, FAQs.',
        minSections: 7,
      })),
      { slug: '/contact', title: 'Contact', intent: 'Contact and booking form, hours, phone.', minSections: 7 },
    ],
    nav: { primary: [{ label: 'Home', href: '/' }], footerGroups: [] },
  };
}

const pages = (parsed.pages ?? []).map((p) => ({
  slug: String(p.slug ?? '/').replace(/\\/+$/, ''),
  title: String(p.title ?? 'Page'),
  intent: String(p.intent ?? ''),
  minSections: Math.max(7, Number(p.minSections ?? 7)),
}));
const primary = (parsed.nav?.primary ?? []).map((i) => ({ label: String(i.label ?? ''), href: String(i.href ?? '#') })).filter((i) => i.label && i.href !== '#');
const footerGroups = (parsed.nav?.footerGroups ?? []).map((g) => ({
  group: String(g.group ?? 'More'),
  items: (g.items ?? []).map((i) => ({ label: String(i.label ?? ''), href: String(i.href ?? '#') })).filter((i) => i.label && i.href !== '#'),
}));

return [{
  json: { ...request, ...research, pages, nav: { primary, footerGroups }, parsed_ok: parsed !== null },
}];`,
  }),
  codeNode({
    name: 'Build Navigation',
    jsCode: `// Builds sites.navigation.items from the sitemap. The tenant layout serves
// navigation.items whenever non-empty — the empty-array bug was why every site
// showed only Home/About/Contact while 8 other pages were unreachable.
const site = $input.first().json;
const pages = site.pages ?? [];
const nav = site.nav ?? { primary: [], footerGroups: [] };

const primary = (nav.primary ?? []).concat(
  pages
    .filter((p) => p.slug === '/' || p.slug === '/about' || p.slug === '/contact')
    .map((p) => ({ label: p.slug === '/' ? 'Home' : p.title, href: p.slug }))
);
const seen = new Set();
const primaryUnique = primary.filter((i) => (seen.has(i.href) ? false : (seen.add(i.href), true)));
const footerItems = [];
for (const group of nav.footerGroups ?? []) {
  for (const item of group.items ?? []) {
    if (!seen.has(item.href)) { seen.add(item.href); footerItems.push({ label: item.label, href: item.href }); }
  }
}
for (const p of pages) {
  if (!seen.has(p.slug)) { seen.add(p.slug); footerItems.push({ label: p.title, href: p.slug }); }
}

return [{ json: { ...site, navigation: { items: primaryUnique, footer: footerItems } } }];`,
  }),
  httpNode({
    name: 'Upsert Site Row',
    method: 'POST',
    url: `${SUPABASE_REST}/sites?on_conflict=slug`,
    jsonBody: `={{ JSON.stringify({
  slug: $json.slug,
  domain: $json.domain,
  preview_subdomain: $json.preview_subdomain,
  niche: $json.niche,
  city: $json.city,
  business_info: {
    name: $json.business_name,
    phone: $json.phone,
    address: $json.address || undefined,
    services: $json.services,
    lead: $json.doctor_or_lead || undefined,
  },
  design_genome: $json.genome,
  navigation: $json.navigation,
  seo_global: { title_template: $json.business_name + ' | ' + $json.city },
  status: "preview",
}) }}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
      { name: 'Prefer', value: 'resolution=merge-duplicates,return=representation' },
    ],
  }),
  codeNode({
    name: 'Expand Pages',
    jsCode: `const siteResp = $input.first().json;
const siteRow = siteResp[0] ?? siteResp; // return=representation -> array
if (!siteRow?.id) throw new Error('Upsert Site Row did not return a site id.');

const ctx = $('Parse Sitemap').first().json;
const design_brief = [
  'SHELL: ' + (ctx.genome?.shell_archetype ?? ''),
  'NAV: ' + (ctx.genome?.nav_topology ?? ''),
  'COLOUR MODE: ' + (ctx.genome?.color_mode ?? ''),
  'RHYTHM: ' + (ctx.genome?.rhythm ?? ''),
  'MOTION: ' + (ctx.genome?.motion_profile ?? ''),
  '',
  ctx.design_skill ?? '',
].join('\\n');

return (ctx.pages ?? []).map((page) => ({
  json: {
    run_id: ctx.run_id,
    site_id: siteRow.id,
    slug: page.slug,
    title: page.title,
    intent: page.intent,
    minSections: page.minSections,
    domain: ctx.domain,
    business_name: ctx.business_name,
    niche: ctx.niche,
    city: ctx.city,
    services: ctx.services,
    phone: ctx.phone,
    address: ctx.address ?? null,
    doctor_or_lead: ctx.doctor_or_lead ?? null,
    genome: ctx.genome,
    design_brief,
    research_brief: ctx.research_brief,
    navigation: ctx.navigation,
    retry_count: 0,
    issues: [],
  },
}));`,
  }),
  splitInBatchesNode({ name: 'Loop Pages', batchSize: 1 })
);

/* ---- per-page: creator -> gate -> analyzer -> retry loop ------------------- */
v3BuilderNodes.push(
  agentNode({
    name: 'Page Creator Agent',
    systemMessage: `You are a senior front-end engineer and conversion copywriter. You write ONE page of a client
website as MDX — the page you are given, and nothing else. You write real, specific,
locally-relevant copy. Never lorem ipsum, never filler.

HARD RULES
1. OUTPUT: a single fenced block exactly like:
   \`\`\`mdx
   <section className="...">...</section>
   \`\`\`
   Nothing before or after it. No commentary, no multiple blocks.
2. DESIGN FIDELITY: honour the design brief exactly (grid, rhythm, density, surface). A reader
   must be able to tell this page apart from another site's page.
3. COLOUR/TYPE: NEVER write hex codes, rgb(), or font names. Use ONLY the CSS variables in the
   design brief: var(--bg-canvas) var(--bg-surface) var(--bg-contrast) var(--text-primary)
   var(--text-muted) var(--brand-primary) var(--brand-accent) var(--on-brand) var(--radius-card)
   var(--radius-button) var(--section-gap) var(--container-width) var(--display-scale)
   var(--font-heading) var(--font-body).
4. CLASSES: all layout classes INSIDE className="..." so they compile. Tailwind arbitrary values
   are encouraged: p-[38px], grid-cols-[1.1fr_0.9fr]. NEVER nest minmax() in grid-template-columns.
5. EXACTLY ONE <h1>. Every <img> needs a descriptive alt.
6. SECTIONS: write AT LEAST {{ $json.minSections }}. Each section is its own <section> element
   with a className. Fewer sections FAILS review.
7. MOTION + 3D (REQUIRED — a page with none is a static page and FAILS review):
   - <ScrollProgress /> — use on EVERY page
   - <Reveal>...</Reveal> wraps a whole section, optional delay={0.1} y={24}
   - <Parallax speed={0.2}>...</Parallax> around a hero visual or full-bleed band
   - <StatCounter stats={[{value:1200,suffix:"+",label:"..."}]} /> count-up — REAL figures
     from the research brief only
   - <TiltCard>...</TiltCard> 3D pointer tilt for cards
   - <StickyScene height="200vh">...</StickyScene> pins its child — ONCE per page for the
     strongest single idea
   - <Marquee items={["A","B","C"]} /> infinite trust strip
   - <ParticleField density={70} /> canvas particles — inside a hero or band
   - <Scene3D shape="torus" color="var(--brand-primary)" wireframe={true} /> WebGL shape —
     REQUIRED on the HOME page hero
   CONTENT components (server-rendered):
   - <QuickSummary points={["...","..."]} />
   - <CostComparisonTable title="..." rows={[{label,detail,price}]} />
   - <FaqAccordion title="..." items={[{q,a}]} />
   - <DoctorReviewedBadge name="..." credentials="..." date="..." />
   - <Callout type="note|tip|warning">text</Callout>
   - <InlineLeadCTA ctaText="..." service="..." phone="..." />
   MOTION RULES: every page MUST use <ScrollProgress /> plus at least two of <Reveal>,
   <Parallax>, <StatCounter>, <TiltCard>, <StickyScene>, <Marquee>, <ParticleField>, <Scene3D>.
   The HOME page MUST include <Scene3D> in its hero AND at least one <StickyScene>.
   Never nest a motion component inside another motion component's props.
8. FACTS: never invent awards, review counts, certifications, statistics, prices, or staff
   names. Only facts in the research brief or business facts. If a fact is unknown, write copy
   that does not need it.
9. PROSE: UK/Indian English. Concrete nouns and numbers. No "in today's fast-paced world", no
   "unlock", no "elevate", no "delve".
9a. DO NOT WRITE PAGE CHROME. The site already renders the header bar, the nav menu, the logo,
   the footer and the site's business name as the display title. You MUST NOT emit <header>,
    <nav>, <footer>, or an <h1> that merely repeats the business name. Start your page with the
    first <section> of real content and use <h2> for its heading. Writing your own header,
    footer or nav produces TWO of them stacked on the live page. Your <h1> must be a real
    page-specific headline, not the business name.
9b. NEVER write a phone number as loose text. Phone numbers appear only inside
    <InlineLeadCTA phone="..." /> or a tel: link, both of which are styled and clickable.
9c. Do not use raw HTML <details>, <summary> or <table>. Use <FaqAccordion .../> and
    <CostComparisonTable .../> instead, which are styled and keyboard accessible.
9d. Do not write steps.length, [0].length, or any expression that evaluates to NaN. If you need
    a sticky scroll height, pass a NUMBER to <StickyScene height={2} /> - not "200vh".
9e. Do not reference pages that are not in your sitemap. Every <a href> must point to a page
    you were asked to generate.
10. Escape a bare "<" in prose as &lt; (e.g. "&lt; 30 minutes").
11. Do NOT add a footer. The site's footer (business name, phone, nav links, copyright) is
    rendered by the layout on every page; emitting another one produces two stacked footers.`,
    text: `=Write the page "{{ $json.title }}" for this client.

PAGE BRIEF
{{ $json.intent }}

DESIGN BRIEF (shape the page around this exactly)
{{ $json.design_brief }}

RESEARCH BRIEF (the only facts you may state)
{{ $json.research_brief }}

BUSINESS FACTS
Business: {{ $json.business_name }}
Niche: {{ $json.niche }}
City: {{ $json.city }}
Phone: {{ $json.phone }}
Services: {{ JSON.stringify($json.services) }}

Minimum sections: {{ $json.minSections }}

ISSUES FROM THE LAST REVIEW (fix every one; empty means first draft)
{{ JSON.stringify($json.issues) }}

Return only the fenced \`\`\`mdx block.`,
  }),
  lmNode({ name: 'Model - Page Creator' }),
  httpNode({
    name: 'Compile Gate',
    method: 'POST',
    url: `${ENGINE_URL}/api/compile`,
    jsonBody: `={{ JSON.stringify({ mdxBlocks: [ String($json.output ?? $json.text ?? '') ] }) }}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'x-compile-secret', value: COMPILE_SECRET },
    ],
  }),
  ifNode({ name: 'MDX Valid?', leftValue: '={{ $json.valid }}', rightValue: '' }),
  codeNode({
    name: 'Prepare Page For Review',
    jsCode: `// The creator emits ONLY {output: "<mdx>"} and the gate emits {valid, css}.
// This node reattaches the FULL page context (slug, title, minSections,
// research_brief) PLUS the mdx, so the analyzer can actually review it.
// Inside the SplitInBatches loop, $('Loop Pages') returns the CURRENT item.
const loopItem = $('Loop Pages').first().json ?? {};
const creator = $('Page Creator Agent').first().json;
const gate = $input.first().json;
return [{
  json: {
    ...loopItem,
    mdx: String(creator.output ?? creator.text ?? creator.mdx ?? ''),
    css: String(gate.css ?? ''),
  },
}];`,
  }),
  agentNode({
    name: 'Page Quality Analyzer',
    systemMessage: `You are a ruthless design and copy QA reviewer. You review ONE generated page and return a
verdict. You are not lenient: a template-ish page fails.

Check, IN ORDER:
1. SECTION COUNT: count the <section> elements. Fewer than {{ $json.minSections }} -> fail.
2. MOTION/3D: <ScrollProgress /> plus at least two of Reveal/Parallax/StatCounter/TiltCard/
   StickyScene/Marquee/ParticleField/Scene3D? Home page must have Scene3D and StickyScene.
   Missing -> fail, name the exact missing ones.
3. H1 COUNT: exactly one <h1>. Zero or two+ -> fail.
4. FABRICATION: any invented statistic, price, award, staff name, review count not in the
   research brief -> fail, name the fabricated fact.
5. PLACEHOLDER: lorem ipsum, "TODO", "example.com" links, empty sections -> fail. Also fail if
   the page is EMPTY or contains no <section> at all - an empty string passes an MDX syntax
   check, and an agent that returned an error envelope produces one. That must never publish.
6. DESIGN FIDELITY: inline hex/rgb()/font names instead of the CSS variables -> fail.
7. LAYOUT: nested minmax() in grid-template-columns, trapped JSX, walls of text -> fail.

Return ONLY a fenced JSON block:
\`\`\`json
{
  "verdict": "pass" | "retry" | "salvage",
  "score": 0-100,
  "sections_found": N,
  "motion_present": ["Reveal"], 
  "h1_count": N,
  "issues": ["specific, actionable issue 1", "issue 2"]
}
\`\`\`
"pass" = publish it. "retry" = fixable, be specific. "salvage" = beyond repair.`,
    text: `=Review this generated page.

Page: {{ $json.title }} (slug {{ $json.slug }})
Required minimum sections: {{ $json.minSections }}
Is home page: {{ $json.slug === '/' ? 'yes' : 'no' }}

RESEARCH BRIEF (the only permitted facts):
{{ $json.research_brief }}

THE PAGE MDX TO REVIEW:
{{ $json.mdx }}

Return ONLY the fenced \`\`\`json verdict block.`,
  }),
  lmNode({ name: 'Model - Analyzer' }),
  codeNode({
    name: 'Parse Verdict',
    jsCode: `const item = $input.first().json;
const review = $('Prepare Page For Review').first().json;
const raw = String(item.output ?? item.text ?? '');
let verdict = { verdict: 'retry', score: 0, sections_found: 0, motion_present: [], h1_count: 0, issues: ['Analyzer output was not parseable: ' + raw.slice(0, 200)] };
try {
  const clean = raw.replace(/^\u0060\u0060\u0060[\\w-]*\\s*/, '').replace(/\\s*\u0060\u0060\u0060$/, '').trim();
  const parsed = JSON.parse(clean);
  verdict = {
    verdict: ['pass', 'retry', 'salvage'].includes(parsed.verdict) ? parsed.verdict : 'retry',
    score: Number(parsed.score ?? 0),
    sections_found: Number(parsed.sections_found ?? 0),
    motion_present: Array.isArray(parsed.motion_present) ? parsed.motion_present : [],
    h1_count: Number(parsed.h1_count ?? 0),
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
  };
} catch (err) {}
return [{
  json: {
    ...review,
    ...verdict,
    retry_count: Number(review.retry_count ?? 0),
  },
}];`,
  }),
  ifNode({ name: 'Route Verdict', leftValue: '={{ $json.verdict }}', rightValue: 'pass' }),
  ifNode({ name: 'Retries Left', leftValue: '={{ $json.retry_count }}', rightValue: '2' }),
  codeNode({
    name: 'Bump Retry',
    jsCode: `// Retry path: the FULL page context is already on the item (from Parse
// Verdict's spread of Prepare Page For Review). Increment retry_count and pass
// the analyzer's issues back to the Page Creator verbatim.
const item = $input.first().json;
return [{
  json: {
    ...item,
    retry_count: (Number(item.retry_count ?? 0) || 0) + 1,
    issues: Array.isArray(item.issues) ? item.issues : [],
  },
}];`,
  }),
  codeNode({
    name: 'Assemble Valid Page',
    jsCode: `// Merge the reviewed MDX + compiled CSS into the pages-table row shape.
const page = $input.first().json;
const gate = $('Compile Gate').first().json;

// HARD GUARD: an empty string IS valid MDX, so the compile gate passes it, and
// an agent that returned an error envelope (or nothing) produces one. Storing
// that with published:true is a blank page on a live site. Route it to the
// salvage branch instead: a page that says "under review" beats a page that is
// visibly empty while claiming to be published.
const rawMdx = String(page.mdx ?? '').trim();
const isEmptyMdx =
  !rawMdx ||
  (rawMdx.length < 400 && !/<section/i.test(rawMdx)) ||
  !rawMdx.includes('<') ||
  rawMdx.includes('service failed to process');

if (isEmptyMdx) {
  return [{
    json: {
      site_id: page.site_id,
      slug: String(page.slug ?? '').replace(/^\\//, ''),
      title: page.title ?? '',
      sections: [{ mdx: '<section className="shell-section"><p className="shell-body">This page requires manual review before publishing.</p></section>', anchor: 'content' }],
      compiled_css: '',
      published: false,
      salvage_reason: 'empty or non-markup output from the page creator',
    },
  }];
}

const request = $('Normalize Site Request').first().json;

// STRIP DUPLICATE CHROME. The shell renders header/footer/nav/H1 itself, but the
// page agent writes a self-contained page and emits its own - giving two headers,
// two footers and two <h1>s on screen (the audit's top finding).
//
// NOTE ON ESCAPING: this block runs inside an n8n Code node, emitted through a
// JS template literal in this generator. Backslash-heavy regex literals do NOT
// survive that chain (each transport layer eats one level). This implementation
// therefore uses ONLY string ops - indexOf/slice/toLowerCase - which have zero
// backslash-sensitive content. src/lib/sanitize-mdx.ts carries the regex-based
// equivalent with tests; keep the BEHAVIOUR in step when editing.
function dropTag(tag, html) {
  let out = String(html);
  const openNeedle = '<' + tag;
  const closeNeedle = '</' + tag + '>';
  for (let guard = 0; guard < 12; guard++) {
    const lower = out.toLowerCase();
    const at = lower.indexOf(openNeedle);
    if (at === -1) break;
    const gt = out.indexOf('>', at);
    if (gt === -1) break;
    if (out[gt - 1] === '/') {
      out = out.slice(0, at) + out.slice(gt + 1);
      continue;
    }
    let depth = 1;
    let cursor = gt + 1;
    let closed = -1;
    while (depth > 0) {
      const l2 = out.toLowerCase();
      const no = l2.indexOf(openNeedle, cursor);
      const nc = l2.indexOf(closeNeedle, cursor);
      if (nc === -1) { closed = -1; break; }
      if (no !== -1 && no < nc) {
        const g2 = out.indexOf('>', no);
        if (g2 === -1) { closed = -1; break; }
        if (out[g2 - 1] !== '/') depth += 1;
        cursor = g2 + 1;
      } else {
        depth -= 1;
        cursor = nc + closeNeedle.length;
        if (depth === 0) closed = cursor;
      }
    }
    if (closed === -1) break;
    out = out.slice(0, at) + out.slice(closed);
  }
  return out;
}

function stripTagsText(html) {
  let out = '';
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (ch === '<') { inTag = true; continue; }
    if (ch === '>') { inTag = false; continue; }
    if (!inTag) out += ch;
  }
  return out;
}

function dedupeH1(html, businessName) {
  const name = String(businessName == null ? '' : businessName).trim().toLowerCase();
  const lower = html.toLowerCase();
  const spans = [];
  let from = 0;
  for (;;) {
    const a = lower.indexOf('<h1', from);
    if (a === -1) break;
    const gt = html.indexOf('>', a);
    if (gt === -1) break;
    const c = lower.indexOf('</h1', gt);
    if (c === -1) break;
    const ce = html.indexOf('>', c);
    if (ce === -1) break;
    const text = stripTagsText(html.slice(gt + 1, c)).trim();
    spans.push({ start: a, end: ce + 1, isName: name.length > 0 && text.toLowerCase().indexOf(name) !== -1 });
    from = ce + 1;
  }
  if (spans.length <= 1) return html;
  let keep = 0;
  for (let i = 0; i < spans.length; i++) {
    if (!spans[i].isName) { keep = i; break; }
  }
  let out = html;
  for (let i = spans.length - 1; i >= 0; i--) {
    if (i === keep) continue;
    out = out.slice(0, spans[i].start) + out.slice(spans[i].end);
  }
  return out;
}

let cleaned = rawMdx;
for (const tag of ['header', 'footer', 'nav']) cleaned = dropTag(tag, cleaned);
cleaned = dedupeH1(cleaned, request.business_name);

// If stripping chrome removed everything, treat as salvage rather than storing
// a page whose markup is gone.
if (!cleaned.includes('<section')) {
  return [{
    json: {
      site_id: page.site_id,
      slug: String(page.slug ?? '').replace(/^\\//, ''),
      title: page.title ?? '',
      sections: [{ mdx: '<section className="shell-section"><p className="shell-body">This page requires manual review before publishing.</p></section>', anchor: 'content' }],
      compiled_css: '',
      published: false,
      salvage_reason: 'chrome removal left no page sections',
    },
  }];
}

return [{
  json: {
    site_id: page.site_id,
    slug: String(page.slug ?? '').replace(/^\\//, ''),
    title: page.title ?? '',
    sections: [{ mdx: cleaned, anchor: 'content' }],
    compiled_css: String(page.css ?? gate.css ?? ''),
    published: true,
  },
}];`,
  }),
  codeNode({
    name: 'Mark Page Salvaged',
    jsCode: `const page = $input.first().json;
const loopItem = $('Loop Pages').first().json ?? {};
return [{
  json: {
    site_id: loopItem.site_id ?? page.site_id,
    slug: String(loopItem.slug ?? '').replace(/^\\//, ''),
    title: loopItem.title ?? '',
    sections: [{ mdx: '<section className="shell-section"><p className="shell-body">This page requires manual review before publishing.</p></section>', anchor: 'content' }],
    compiled_css: '',
    published: false,
  },
}];`,
  }),
  httpNode({
    name: 'Upsert Page',
    method: 'POST',
    url: `${SUPABASE_REST}/pages?on_conflict=site_id,slug`,
    jsonBody: `={{ JSON.stringify({ site_id: $json.site_id, slug: $json.slug, title: $json.title, sections: $json.sections, compiled_css: $json.compiled_css, published: $json.published }) }}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
      { name: 'Prefer', value: 'resolution=merge-duplicates,return=representation' },
    ],
  }),
  codeNode({
    name: 'Collect Page Results',
    jsCode: `// Upsert Page returns the DB row (representations). The pages table has no
// 'salvable' column, but salvaged pages are stored with published=false — that
// IS the salvaged signal, so no schema change is needed.
const row = $input.first().json;
return [{
  json: { site_id: row.site_id, slug: row.slug, salvaged: row.published === false },
}];`,
  })
);

/* ---- loop exit: decide status -> finalize -> revalidate -> respond --------- */
v3BuilderNodes.push(
  codeNode({
    name: 'Decide Site Status',
    jsCode: `const results = $('Collect Page Results').all().map((i) => i.json).filter((r) => r && r.slug);
const salvaged = results.filter((r) => r.salvaged === true).length;
const total = results.length;
const siteRow = $('Upsert Site Row').first().json;
const realRow = siteRow[0] ?? siteRow;
return [{
  json: {
    site_id: realRow.id,
    status: total > 0 && salvaged === 0 ? 'live' : 'preview',
    site_domain: realRow.domain ?? realRow.preview_subdomain,
    pages_total: total,
    pages_salvaged: salvaged,
  },
}];`,
  }),
  httpNode({
    name: 'Finalize Site Status',
    method: 'PATCH',
    url: `={{ '${SUPABASE_REST}/sites?id=eq.' + encodeURIComponent($json.site_id) }}`,
    jsonBody: `={{ JSON.stringify({ status: $json.status }) }}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'apikey', value: SUPABASE_KEY },
      { name: 'Authorization', value: `=Bearer ${SUPABASE_KEY}` },
      { name: 'Prefer', value: 'return=representation' },
    ],
  }),
  ifNode({
    name: 'Site Healthy?',
    leftValue: '={{ $(\'Decide Site Status\').first().json.status }}',
    rightValue: 'live',
  }),
  httpNode({
    name: 'Revalidate Tenant',
    method: 'POST',
    url: `${ENGINE_URL}/api/revalidate`,
    // After 'Finalize Site Status' (a PATCH with return=representation) the item
    // is the RAW DB ROW - it has 'status' but NOT 'site_domain'. Read the domain
    // from its source node instead of $json.
    jsonBody: `={{ JSON.stringify({ domain: $('Decide Site Status').first().json.site_domain, type: 'all' }) }}`,
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'x-revalidate-secret', value: REVALIDATE_SECRET },
    ],
  }),
  codeNode({
    name: 'Build Site Response',
    jsCode: `const decision = $('Decide Site Status').first().json;
const results = $('Collect Page Results').all().map((i) => i.json).filter((r) => r && r.slug);
return [{
  json: {
    status: decision.status,
    site_id: decision.site_id,
    domain: decision.site_domain,
    pages_generated: results.filter((r) => r.salvaged !== true).length,
    pages_salvaged: decision.pages_salvaged,
    preview_url: 'https://' + decision.site_domain,
  },
}];`,
  }),
  respondNode({ name: 'Respond - Site Created', bodyExpression: '={{ $json }}' })
);

/* ---- connections ----------------------------------------------------------- */
v3BuilderConnections['Webhook - Create Next.js Site'] = { main: [[edge('Normalize Site Request')]] };
v3BuilderConnections['Normalize Site Request'] = { main: [[edge('Get Design Genome')]] };
v3BuilderConnections['Get Design Genome'] = { main: [[edge('Prepare Research Prompt')]] };
v3BuilderConnections['Prepare Research Prompt'] = { main: [[edge('Research Agent')]] };
v3BuilderConnections['Search Web'] = { ai_tool: [[edge('Research Agent', 0, 'ai_tool')]] };
v3BuilderConnections['Fetch Web Page'] = { ai_tool: [[edge('Research Agent', 0, 'ai_tool')]] };
v3BuilderConnections['Model - Research'] = { ai_languageModel: [[edge('Research Agent', 0, 'ai_languageModel')]] };
v3BuilderConnections['Research Agent'] = { main: [[edge('Prepare Sitemap Prompt')]] };
v3BuilderConnections['Prepare Sitemap Prompt'] = { main: [[edge('Sitemap Architect')]] };
v3BuilderConnections['Model - Sitemap'] = { ai_languageModel: [[edge('Sitemap Architect', 0, 'ai_languageModel')]] };
v3BuilderConnections['Sitemap Architect'] = { main: [[edge('Parse Sitemap')]] };
v3BuilderConnections['Parse Sitemap'] = { main: [[edge('Build Navigation')]] };
v3BuilderConnections['Build Navigation'] = { main: [[edge('Upsert Site Row')]] };
v3BuilderConnections['Upsert Site Row'] = { main: [[edge('Expand Pages')]] };
v3BuilderConnections['Expand Pages'] = { main: [[edge('Loop Pages')]] };
v3BuilderConnections['Loop Pages'] = {
  main: [[edge('Decide Site Status')], [edge('Page Creator Agent')]],
};
v3BuilderConnections['Model - Page Creator'] = { ai_languageModel: [[edge('Page Creator Agent', 0, 'ai_languageModel')]] };
v3BuilderConnections['Page Creator Agent'] = { main: [[edge('Compile Gate')]] };
v3BuilderConnections['Compile Gate'] = { main: [[edge('MDX Valid?')]] };
v3BuilderConnections['MDX Valid?'] = {
  main: [[edge('Prepare Page For Review')], [edge('Mark Page Salvaged')]],
};
v3BuilderConnections['Prepare Page For Review'] = { main: [[edge('Page Quality Analyzer')]] };
v3BuilderConnections['Model - Analyzer'] = { ai_languageModel: [[edge('Page Quality Analyzer', 0, 'ai_languageModel')]] };
v3BuilderConnections['Page Quality Analyzer'] = { main: [[edge('Parse Verdict')]] };
v3BuilderConnections['Parse Verdict'] = { main: [[edge('Route Verdict')]] };
v3BuilderConnections['Route Verdict'] = {
  main: [[edge('Assemble Valid Page')], [edge('Retries Left')]],
};
v3BuilderConnections['Retries Left'] = {
  main: [[edge('Bump Retry')], [edge('Mark Page Salvaged')]],
};
v3BuilderConnections['Bump Retry'] = { main: [[edge('Page Creator Agent')]] };
v3BuilderConnections['Assemble Valid Page'] = { main: [[edge('Upsert Page')]] };
v3BuilderConnections['Mark Page Salvaged'] = { main: [[edge('Upsert Page')]] };
v3BuilderConnections['Upsert Page'] = { main: [[edge('Collect Page Results')]] };
v3BuilderConnections['Collect Page Results'] = { main: [[edge('Loop Pages')]] };
v3BuilderConnections['Decide Site Status'] = { main: [[edge('Finalize Site Status')]] };
v3BuilderConnections['Finalize Site Status'] = { main: [[edge('Site Healthy?')]] };
v3BuilderConnections['Site Healthy?'] = {
  main: [[edge('Revalidate Tenant')], [edge('Revalidate Tenant')]],
};
v3BuilderConnections['Revalidate Tenant'] = { main: [[edge('Build Site Response')]] };
v3BuilderConnections['Build Site Response'] = { main: [[edge('Respond - Site Created')]] };


const siteBuilderNodes = v3BuilderNodes;
const siteBuilderConnections = v3BuilderConnections;
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
    // A NEW TENANT HAS ZERO POSTS, and PostgREST then returns []. Without
    // alwaysOutputData the branch stops here and the whole publish dies silently,
    // so cornerstone seeding never produced a single article.
    allowEmptyOutput: true,
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
// alwaysOutputData on 'Get Existing Posts' means an empty post list arrives as a
// single empty item ({}) rather than zero items, so a naive map would treat that
// placeholder as an existing post. Filter to rows that actually carry a slug.
const existing = $input
  .all()
  .map((item) => item.json)
  .filter((row) => row && typeof row === 'object' && (row.slug || row.title));
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
    jsonBody: `={{ JSON.stringify({
  site_id: $json.site_id,
  slug: $json.slug,
  title: $json.title,
  excerpt: $json.excerpt,
  content_mdx: $json.content_mdx,
  compiled_css: $json.compiled_css,
  category: $json.category,
  tags: $json.tags,
  author: $json.author,
  seo_meta: {
    seo_title: $json.seo_title,
    meta_description: $json.meta_description,
    focus_keyword: $json.focus_keyword,
  },
  reading_time_mins: $json.reading_time_mins,
  status: "published",
}) }}`,
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
    // JSON.stringify instead of interpolating {{ }} into quoted strings.
    //
    // This node runs after 'Upsert Post' (Prefer: return=representation), so $json
    // is the stored post ROW: quoting raw values into JSON risked an invalid body
    // whenever a slug or domain contained a quote, and the values are read by name
    // so a missing field is obvious rather than silently empty. The previous body
    // produced "Bad request - please check your parameters" (execution 120997).
    jsonBody: `={{ JSON.stringify({ domain: $('Normalize Blog Request').first().json.domain, slug: $json.slug, type: 'post' }) }}`,
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
blogNodes.push(lmNode({ name: 'Model - Gemini Argon Blog' }));

/* =========================================================================
 * Emit
 * =======================================================================*/

const siteBuilder = {
  name: 'Anagata Next.js Multi-Tenant Site Builder (v3)',
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

  // An IF condition may not read $json.<field> when its predecessor REPLACES the
// item with a database row. A PATCH/POST with Prefer: return=representation
// returns the row, discarding derived fields - so $json.healthy was undefined on
// a healthy site and seeding was skipped (execution 120983). Such conditions must
// reach back with $('Node').first().json.<field> instead.
  const ROW_RETURNING = /^(Finalize Site Status|Upsert Site|Upsert Pages|Upsert Post)$/;
  for (const node of definition.nodes) {
    if (!/n8n-nodes-base\.if/.test(node.type ?? '')) continue;

    const predecessor = Object.entries(definition.connections).find(([, outputs]) =>
      Object.values(outputs).some((branches) =>
        branches.some((branch) => branch.some((edge) => edge.node === node.name))
      )
    )?.[0];
    if (!predecessor || !ROW_RETURNING.test(predecessor)) continue;

    const leftValue = String(node.parameters?.conditions?.conditions?.[0]?.leftValue ?? '');
    if (/\$json\./.test(leftValue)) {
      throw new Error(
        `${file}: IF "${node.name}" reads $json from "${predecessor}", which returns a raw ` +
          'DB row and drops derived fields - use $(\u0027...\u0027).first().json.<field>'
      );
    }
  }
  console.log(`[ok] ${file}: IF conditions after row-returning nodes do not read $json`);

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
  // SCOPE: ONLY the page pair, and ONLY when it is NOT inside a SplitInBatches
  // loop. Inside a loop each iteration processes exactly ONE item, so .first()
  // is correct there (v3: 'Assemble Valid Page' is inside 'Loop Pages').
  // The blog publisher assembles exactly ONE article per webhook call, so
  // .first() is correct there and must not be flagged.
  const HARD_FANOUT_NODES = ['Assemble Valid Page', 'Salvage MDX Blocks', 'Mark Page Salvaged'];
  const loopNames = new Set(
    definition.nodes.filter((n) => /splitInBatches/i.test(n.type)).map((n) => n.name)
  );
  // Collect every node TRANSITIVELY reachable from a loop's body (output
  // index 1 / branch 1). A node several hops down the chain (creator -> gate ->
  // ... -> assemble) is still inside the loop and processes one item per
  // iteration, so .first() is correct there.
  const inLoopBody = new Set();
  const pending = [];
  for (const [source, outputs] of Object.entries(definition.connections)) {
    if (!loopNames.has(source)) continue;
    for (const branch of outputs.main?.[1] ?? []) {
      if (!inLoopBody.has(branch.node)) {
        inLoopBody.add(branch.node);
        pending.push(branch.node);
      }
    }
  }
  while (pending.length) {
    const name = pending.pop();
    const outputs = definition.connections[name];
    if (!outputs) continue;
    for (const branch of outputs.main?.[0] ?? []) {
      if (branch.node && !inLoopBody.has(branch.node)) {
        inLoopBody.add(branch.node);
        pending.push(branch.node);
      }
    }
    for (const branch of outputs.main?.[1] ?? []) {
      if (branch.node && !inLoopBody.has(branch.node)) {
        inLoopBody.add(branch.node);
        pending.push(branch.node);
      }
    }
  }
  const fanoutTargets = HARD_FANOUT_NODES.filter(
    (name) => definition.nodes.some((n) => n.name === name) && !inLoopBody.has(name)
  );
  if (fanoutTargets.length) {
    for (const name of fanoutTargets) {
      const node = definition.nodes.find((candidate) => candidate.name === name);
      if (!node) continue;
      const live = stripComments(node.parameters.jsCode ?? '');
      if (/\.first\(\)/.test(live)) {
        throw new Error(
          `${file}: "${name}" uses .first() and would collapse the per-page fan-out into one row`
        );
      }
      if (/\$input\.all\(\)/.test(live)) {
        console.log(`[ok] ${file}: ${name} maps over all items`);
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

        // Every Code node's jsCode must PARSE as JavaScript. Nothing else in this
        // file checks that, and the gap cost a live run: an apostrophe inside a
        // single-quoted string ('the firm\'s clients') survived the generator's
        // escaping, landed in the emitted workflow, and threw
        // "Unexpected identifier 's'" at runtime - after the webhook had already
        // returned 500 to the caller. new Function() compiles without executing,
        // so this is a static check.
        for (const node of definition.nodes) {
          const code = node.parameters?.jsCode;
          if (typeof code !== 'string') continue;
          // Code nodes run in 'runOnceForAllItems' mode by default, which wraps
          // the body. Using Function() (not new Function()) is the faithful test:
          // top-level await is prohibited in n8n Code nodes anyway.
          try {
            // eslint-disable-next-line no-new-func
            new Function(code);
          } catch (err) {
            throw new Error(
              `${file}: Code node "${node.name}" jsCode does not parse as JavaScript: ` +
                `${err.message}. A quote or backslash in a string literal is the usual ` +
                `cause - check apostrophes inside single-quoted strings.`
            );
          }
        }
        console.log(`[ok] ${file}: every Code node's jsCode parses as JavaScript`);
      }