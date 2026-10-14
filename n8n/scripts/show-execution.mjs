// Prints the failing node and error from an n8n execution, with credentials redacted.
//
// n8n's error view often blames a downstream node; this walks the execution data
// and reports per-node status plus the LAST node that actually ran, which is where
// the real failure is. Also surfaces error-shaped output from nodes whose status
// is "success" - this codebase has been bitten by that before (a green node
// carrying an {"error": ...} item).
//
// Usage: node n8n/scripts/show-execution.mjs <execution-id> [workflow-id-for-context]

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://n8n.anagataitsolutions.in';
const EXEC_ID = process.argv[2];
if (!EXEC_ID) {
  console.error('usage: node n8n/scripts/show-execution.mjs <execution-id>');
  process.exit(2);
}

function resolveKey() {
  if (process.env.N8N_API_KEY) return process.env.N8N_API_KEY;
  const cfg = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml');
  return readFileSync(cfg, 'utf8').match(/N8N_API_KEY:\s*(\S+)/)[1];
}

const KEY = resolveKey();
const redact = (value) =>
  String(value)
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '<jwt>')
    .replace(/(x-revalidate-secret|apikey|Authorization)["':= ]+\S+/gi, '$1=<redacted>')
    .replace(/(Bearer)\s+\S+/gi, '$1 <redacted>');

const response = await fetch(`${BASE}/api/v1/executions/${EXEC_ID}?includeData=true`, {
  headers: { 'X-N8N-API-KEY': KEY, Accept: 'application/json' },
});
const payload = await response.json();

console.log(`HTTP ${response.status}`);
console.log(`workflow    : ${payload.workflowId}`);
console.log(`status      : ${payload.status}`);
console.log(`started     : ${payload.startedAt}`);
console.log(`stopped     : ${payload.stoppedAt ?? '-'}`);

const runData = payload?.data?.resultData?.runData ?? {};
const lastNode = payload?.data?.resultData?.lastNodeExecuted;

console.log(`lastNodeExecuted : ${lastNode ?? '-'}`);
console.log('');

// Per-node status, in execution order where available.
const order = Object.keys(runData);
console.log('=== nodes that ran ===');
for (const nodeName of order) {
  const runs = runData[nodeName] ?? [];
  for (const run of runs) {
    const status = run?.executionStatus ?? (run?.error ? 'error' : 'ok');
    console.log(`  ${status === 'error' ? 'ERR ' : 'ok  '} ${nodeName}`);
    if (run?.error) {
      const message = run.error.message ?? JSON.stringify(run.error);
      console.log(`        ${redact(String(message)).slice(0, 400)}`);
      if (run.error.description) console.log(`        ${redact(run.error.description).slice(0, 300)}`);
      if (run.error.context) console.log(`        context: ${redact(JSON.stringify(run.error.context)).slice(0, 300)}`);
    }
  }
}

// Any node output carrying an `error` key is a failure even when status is ok.
console.log('');
console.log('=== error-shaped outputs on green nodes ===');
let found = 0;
for (const [nodeName, runs] of Object.entries(runData)) {
  for (const run of runs ?? []) {
    const items = run?.data?.main?.[0] ?? [];
    for (const item of items) {
      const json = item?.json;
      if (json && typeof json === 'object' && ('error' in json || json.valid === false)) {
        found += 1;
        console.log(`  ${nodeName}: ${redact(JSON.stringify(json)).slice(0, 300)}`);
      }
    }
  }
}
if (!found) console.log('  (none)');

// The runtime error, which is what the webhook returned.
const rootError = payload?.data?.resultData?.error;
if (rootError) {
  console.log('');
  console.log('=== root error ===');
  console.log('  node   :', rootError.node?.name ?? rootError.node ?? '-');
  console.log('  message:', redact(rootError.message ?? '').slice(0, 500));
  if (rootError.stack) console.log('  stack  :', redact(rootError.stack).split('\n').slice(0, 4).join('\n           '));
}