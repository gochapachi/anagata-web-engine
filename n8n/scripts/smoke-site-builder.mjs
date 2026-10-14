// End-to-end smoke test for the Next.js site-builder workflow.
//
// WHY THIS EXISTS AS A FILE: an inline `export KEY=$(node -e ...)` form failed
// with a bare "stdin is not a tty" and exit 1, which told us nothing. A real
// script reads its own credentials, uses os.homedir() (a NATIVE Windows path -
// MSYS /c/... paths are unreadable by native node), and reports the FAILING
// NODE instead of the generic {"message":"Workflow execution failed"}.
//
// The workflow's webhook uses responseMode=responseNode, so the HTTP call blocks
// until the run finishes; a fast 500 means an early node threw.
//
// Usage:
//   node n8n/scripts/smoke-site-builder.mjs                      # v2, random business name
//   node n8n/scripts/smoke-site-builder.mjs "My Clinic"          # v2, given name
//   node n8n/scripts/smoke-site-builder.mjs "My Clinic" v1       # target another generation

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'https://n8n.anagataitsolutions.in';

/** Generation knob - cache-busting redeploys mint new ids, so names/paths carry it. */
const SUFFIX = process.argv[3] ?? 'v2';
const WORKFLOW_NAME = `Anagata Next.js Multi-Tenant Site Builder (${SUFFIX})`;
const WEBHOOK_PATH = `nextjs-site-generator-${SUFFIX}`;
const NAME = process.argv[2] ?? `Smoke Test ${crypto.randomBytes(3).toString('hex')}`;

function apiKey() {
  if (process.env.N8N_API_KEY) return process.env.N8N_API_KEY;
  const configPath = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml');
  const match = readFileSync(configPath, 'utf8').match(/N8N_API_KEY:\s*(\S+)/);
  if (!match) throw new Error(`no N8N_API_KEY in ${configPath}`);
  return match[1];
}

const KEY = apiKey();
const HDRS = { 'X-N8N-API-KEY': KEY, Accept: 'application/json' };

function redact(text) {
  return String(text ?? '')
    .replace(/(?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}/g, '<jwt>')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '<jwt>');
}

/** Resolves the workflow id by name, paginating the 100-row /workflows cap. */
async function resolveWorkflowId() {
  const all = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await (await fetch(`${BASE}/api/v1/workflows?${query}`, { headers: HDRS })).json();
    const rows = Array.isArray(res) ? res : (res.data ?? []);
    all.push(...rows);
    // Same fix as activate-workflows.mjs: n8n returns nextCursor with no hasNext
    // field, so keying off hasNext stops after page 1 and a freshly created
    // workflow (sorted past row 100) reads as "missing".
    cursor = Array.isArray(res) ? undefined : res.nextCursor;
    if (!cursor || !rows.length) break;
  }
  const match = all.find((w) => w.name === WORKFLOW_NAME);
  if (!match) {
    console.error(`[FAIL] no workflow named "${WORKFLOW_NAME}" (scanned ${all.length}). Deploy it first.`);
    process.exit(1);
  }
  if (!match.active) {
    console.error(`[FAIL] "${WORKFLOW_NAME}" exists (${match.id}) but is INACTIVE - the webhook would 404.`);
    process.exit(1);
  }
  return match.id;
}

const WORKFLOW_ID = await resolveWorkflowId();

console.log(`workflow : ${WORKFLOW_ID}  (${WORKFLOW_NAME})`);
console.log(`webhook  : ${BASE}/webhook/${WEBHOOK_PATH}`);
console.log(`business : ${NAME}`);
console.log('');

/* ------------------------------------------------------- 1. trigger the hook */
const startedAt = new Date();
const webhookRes = await fetch(`${BASE}/webhook/${WEBHOOK_PATH}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    business_name: NAME,
    niche: 'dental-clinic',
    city: 'Pune',
    phone: '+919****0001',
    services: ['Root Canal', 'Dental Implants'],
    custom_domain: `smoke-${crypto.randomBytes(2).toString('hex')}.example.com`,
  }),
  signal: AbortSignal.timeout(540_000),
}).catch((error) => ({ ok: false, status: 0, _error: error }));

if (webhookRes._error) {
  console.log(`[FAIL] webhook call error: ${webhookRes._error.message}`);
} else {
  const body = await webhookRes.text();
  const secs = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(`webhook  -> HTTP ${webhookRes.status} (${secs}s)`);
  console.log(`body     : ${redact(body).slice(0, 800)}`);
}
console.log('');

/* -------------------------------------------- 2. find that run's execution */
const listRes = await (
  await fetch(`${BASE}/api/v1/executions?limit=5&workflowId=${WORKFLOW_ID}`, { headers: HDRS })
).json();
const runs = listRes.data ?? [];
console.log('=== recent executions ===');
for (const run of runs) {
  console.log(`  ${run.id} | ${String(run.status).padEnd(8)} | ${run.startedAt}`);
}

const target = runs.find((run) => new Date(run.startedAt) >= new Date(startedAt.getTime() - 5000));
if (!target) {
  console.log('\n[WARN] no execution recorded for the run we just triggered.');
  process.exit(1);
}

/* ------------------------------------------------- 3. show what actually ran */
const detail = await (
  await fetch(`${BASE}/api/v1/executions/${target.id}?includeData=true`, { headers: HDRS })
).json();
const result = detail.data?.resultData ?? {};
const runData = result.runData ?? {};

console.log('');
console.log(`=== execution ${target.id} ===`);
console.log(`status   : ${detail.data?.status}`);
console.log(`lastNode : ${result.lastNodeExecuted ?? '-'}`);
console.log('');
console.log('nodes that ran:');

let sawErrorShapeOnGreen = false;
for (const [nodeName, attempts] of Object.entries(runData)) {
  const attempt = attempts[attempts.length - 1] ?? {};
  const status = attempt.executionStatus ?? '?';
  const marker = status === 'error' ? 'ERR ' : status === 'success' ? 'ok  ' : String(status).padEnd(4);
  console.log(`  ${marker} ${nodeName}`);
  if (attempt.error) {
    console.log(`        ${redact(attempt.error.message).slice(0, 300)}`);
  }
  // A green node carrying an {"error": ...} item is this codebase's classic trap:
  // continueRegularOutput turns an exception into an ordinary item and the run
  // still reports success while garbage flows downstream.
  for (const item of attempt.data?.main?.[0] ?? []) {
    if (item?.json && Object.keys(item.json).length === 1 && item.json.error) {
      console.log(`        [error-shaped output on a ${status} node] ${redact(item.json.error).slice(0, 200)}`);
      sawErrorShapeOnGreen = true;
    }
  }
}

if (result.error) {
  console.log('');
  console.log('=== root error ===');
  console.log(`  ${redact(result.error.message).slice(0, 400)}`);
}

const ok = detail.data?.status === 'success';
console.log('');
console.log(
  ok
    ? '[PASS] workflow completed successfully'
    : `[FAIL] execution ${target.id} status=${detail.data?.status} (failing node: ${result.lastNodeExecuted ?? '-'})`
);
if (sawErrorShapeOnGreen) console.log('[NOTE] at least one green node carried an error-shaped item.');
process.exit(ok ? 0 : 1);