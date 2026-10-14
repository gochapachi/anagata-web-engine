// Polls n8n for the newest site-builder execution and prints a verdict.
//
// WHY THIS EXISTS: redirecting smoke-site-builder.mjs to a log file from a
// background bash job dies with "stdin is not a tty" before the workflow is
// even called, and a cmd shim just prints the Windows banner. The execution
// record in n8n is the authoritative source anyway - it survives whatever
// happens to the local stdout.
//
// Usage: node poll-execution.mjs [maxWaitSeconds] [workflowIdSuffix]
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://n8n.anagataitsolutions.in';
const MAX_WAIT = Number(process.argv[2] ?? 0); // 0 = no waiting, just report
const SUFFIX = process.argv[3] ?? 'v2';
const WORKFLOW_NAME = `Anagata Next.js Multi-Tenant Site Builder (${SUFFIX})`;

const KEY =
  process.env.N8N_API_KEY ??
  readFileSync(path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml'), 'utf8').match(
    /N8N_API_KEY:\s*(\S+)/
  )?.[1];
if (!KEY) throw new Error('no N8N_API_KEY');

const HDRS = { 'X-N8N-API-KEY': KEY, Accept: 'application/json' };

const redact = (text) =>
  String(text ?? '')
    .replace(/(?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}/g, '<jwt>')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '<jwt>');

/** Paginates /workflows to resolve the id by name. */
async function workflowId() {
  const all = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(`${BASE}/api/v1/workflows?${query}`, { headers: HDRS });
    const body = await res.json();
    all.push(...(Array.isArray(body) ? body : (body.data ?? [])));
    cursor = Array.isArray(body) ? undefined : body.nextCursor;
    if (!cursor) break;
  }
  const match = all.find((w) => w.name === WORKFLOW_NAME);
  if (!match) throw new Error(`no workflow named "${WORKFLOW_NAME}"`);
  return match.id;
}

const ID = await workflowId();
console.log(`workflow: ${ID} (${WORKFLOW_NAME})`);

const deadline = Date.now() + MAX_WAIT * 1000;
let report = null;

while (true) {
  const list = await (await fetch(`${BASE}/api/v1/executions?limit=1&workflowId=${ID}`, { headers: HDRS })).json();
  const latest = (list.data ?? [])[0];
  if (latest) report = latest;
  if (!latest || (latest.status !== 'running' && latest.status !== 'new') || Date.now() > deadline) break;
  await new Promise((r) => setTimeout(r, 15000));
}

if (!report) {
  console.log('no executions found for this workflow');
  process.exit(1);
}

const detail = await (
  await fetch(`${BASE}/api/v1/executions/${report.id}?includeData=true`, { headers: HDRS })
).json();
const result = detail.data?.resultData ?? {};
const runData = result.runData ?? {};

console.log(`execution: ${report.id}  status=${detail.data?.status}  started=${report.startedAt}`);
console.log('');

for (const [name, attempts] of Object.entries(runData)) {
  const last = attempts[attempts.length - 1] ?? {};
  const status = last.executionStatus ?? '?';
  const count = (last.data?.main?.[0] ?? []).length;
  const marker = status === 'error' ? 'ERR ' : status === 'success' ? 'ok  ' : String(status).padEnd(4);
  console.log(`  ${marker} ${name.padEnd(30)} items=${count}`);
  if (last.error) console.log(`        ${redact(last.error.message).slice(0, 240)}`);
}

if (result.error) {
  console.log('');
  console.log(`root error: ${redact(result.error.message).slice(0, 300)}`);
}

console.log('');
if (detail.data?.status === 'success') {
  const merged = runData['Merge Page Results']?.at(-1)?.data?.main?.[0] ?? [];
  const pages = runData['Upsert Pages']?.at(-1)?.data?.main?.[0] ?? [];
  console.log(`[PASS] pages merged=${merged.length} rows written=${pages.length}`);
  console.log(
    merged.length >= 2 && pages.length >= 2
      ? '[ok] multi-page fan-out survived to the database'
      : '[WARN] fan-out still collapsed - inspect item counts above'
  );
} else {
  console.log(`[FAIL] ${detail.data?.status} at "${result.lastNodeExecuted}"`);
}