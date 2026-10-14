// Diagnoses two open questions from the green run (execution 120885):
//
//   Q1  Why did services/dental-implants and services/root-canal get an EMPTY
//       mdx string? Was the agent output empty, or was real text stripped away?
//   Q2  Did 'Seed Cornerstone Blogs' fire ONCE (executeOnce working) or once per
//       page? Five blog-publisher executions appeared at the same second, which
//       would mean a 5-page site seeds 10 articles instead of 2.
//
// Usage: node diagnose-green-run.mjs [siteBuilderExecId] [blogWorkflowId]

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://n8n.anagataitsolutions.in';
const SITE_EXEC = process.argv[2] ?? '120885';
const BLOG_WF = process.argv[3] ?? 'rVsGpyFO4MunNndo';

const KEY =
  process.env.N8N_API_KEY ??
  readFileSync(path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml'), 'utf8').match(
    /N8N_API_KEY:\s*(\S+)/
  )?.[1];
const HDRS = { 'X-N8N-API-KEY': KEY, Accept: 'application/json' };

/* ------------------------------------------------------------------ Q1 */
const detail = await (
  await fetch(`${BASE}/api/v1/executions/${SITE_EXEC}?includeData=true`, { headers: HDRS })
).json();
const runData = detail.data?.resultData?.runData ?? {};

const blueprints = runData['Build Page Blueprints']?.at(-1)?.data?.main?.[0] ?? [];
const agentItems = runData['Page Architect Agent']?.at(-1)?.data?.main?.[0] ?? [];
const gateItems = runData['Compile Gate']?.at(-1)?.data?.main?.[0] ?? [];
const assembled = runData['Assemble Valid Page']?.at(-1)?.data?.main?.[0] ?? [];

console.log(`=== Q1: per-page pipeline (execution ${SITE_EXEC}) ===`);
console.log('slug                          agent_bytes  gate_valid  assembled_mdx_bytes');
console.log('----------------------------------------------------------------------');

blueprints.forEach((item, i) => {
  const slug = String(item.json?.slug ?? '?').padEnd(28);
  const raw = agentItems[i]?.json;
  const outLen = String(raw?.output ?? raw?.text ?? '').length;
  const gate = gateItems[i]?.json;
  const valid = gate?.valid === undefined ? '-' : String(gate.valid);
  const mdxLen = String(assembled[i]?.json?.sections?.[0]?.mdx ?? '').length;
  console.log(`${slug}  ${String(outLen).padStart(11)}  ${valid.padStart(10)}  ${String(mdxLen).padStart(19)}`);
});

const emptyAgent = agentItems
  .map((item, i) => ({ i, slug: blueprints[i]?.json?.slug, len: String(item.json?.output ?? item.json?.text ?? '').length }))
  .filter((entry) => entry.len === 0);

console.log('');
if (emptyAgent.length) {
  console.log(`[FOUND] ${emptyAgent.length} page(s) had EMPTY agent output:`);
  for (const entry of emptyAgent) console.log(`   index ${entry.i}: ${entry.slug}`);
  console.log('        -> the agent returned nothing, and the empty block passed the gate.');
} else {
  console.log('[ok] every page had non-empty agent output.');
}

// Show the raw shape of one empty item, to see whether it is '' or a refusal message.
for (const entry of emptyAgent.slice(0, 2)) {
  const item = agentItems[entry.i]?.json ?? {};
  console.log('');
  console.log(`--- raw agent item ${entry.i} (${entry.slug}) keys: ${Object.keys(item).join(', ')} ---`);
  console.log(JSON.stringify(item).slice(0, 400));
}

/* ------------------------------------------------------------------ Q2 */
console.log('');
console.log('=== Q2: did the blog seed fire once, or once per page? ===');
const execs = await (
  await fetch(`${BASE}/api/v1/executions?limit=12&workflowId=${BLOG_WF}`, { headers: HDRS })
).json();
const rows = (execs.data ?? []).filter((e) => e.startedAt >= '2026-10-14T14:39:00Z');

console.log(`blog-publisher executions since 14:39:00Z: ${rows.length}`);
for (const e of rows) {
  console.log(`   ${e.id} | ${String(e.status).padEnd(8)} | ${e.startedAt}`);
}

const triggers = [];
for (const e of rows.slice(0, 6)) {
  const d = await (await fetch(`${BASE}/api/v1/executions/${e.id}?includeData=true`, { headers: HDRS })).json();
  const rd = d.data?.resultData?.runData ?? {};
  const first = Object.keys(rd)[0];
  triggers.push(first);
}
const webhookStarts = triggers.filter((t) => t === 'Webhook - Publish Next.js Blog').length;

console.log('');
console.log(`   of those sampled, ${webhookStarts}/${triggers.length} started at the WEBHOOK (i.e. fired by the seed)`);
if (rows.length > 1 && webhookStarts > 1) {
  console.log('   [CONFIRMED] the seed fired once per page - executeOnce did NOT suppress the fan-out.');
  console.log('   [IMPACT]    a 5-page site seeds count x 5 articles, not count x 1.');
} else {
  console.log('   [ok] the seed fired once.');
}