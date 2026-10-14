// Dumps one node's input and error from an execution, redacted.
//
// Used to debug a specific failing node without re-running the workflow (which
// costs minutes of LLM time). Prints the outgoing JSON of the previous node and
// the failing node's own request where available.
//
// Usage: node show-node.mjs <executionId> <nodeName>
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://n8n.anagataitsolutions.in';
const [EXEC, NODE] = process.argv.slice(2);
if (!EXEC || !NODE) {
  console.error('usage: node show-node.mjs <executionId> <nodeName>');
  process.exit(2);
}

const KEY =
  process.env.N8N_API_KEY ??
  readFileSync(path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml'), 'utf8').match(
    /N8N_API_KEY:\s*(\S+)/
  )?.[1];
const HDRS = { 'X-N8N-API-KEY': KEY, Accept: 'application/json' };

const redact = (value) =>
  JSON.stringify(value, null, 1)
    ?.replace(/((?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,})/g, '<jwt>')
    .replace(/(sk-[A-Za-z0-9]{20,})/g, '<key>')
    .replace(/(AIza[A-Za-z0-9_-]{20,})/g, '<gkey>')
    .slice(0, 3000) ?? '';

const detail = await (
  await fetch(`${BASE}/api/v1/executions/${EXEC}?includeData=true`, { headers: HDRS })
).json();
const runData = detail.data?.resultData?.runData ?? {};

const names = Object.keys(runData);
console.log(`execution ${EXEC}: ${detail.data?.status}`);
console.log(`nodes: ${names.join(', ')}\n`);

const node = names.find((n) => n === NODE);
if (!node) {
  console.error(`node "${NODE}" not found in this execution`);
  process.exit(1);
}

for (const [name, attempts] of Object.entries(runData)) {
  if (name !== node) continue;
  const last = attempts[attempts.length - 1] ?? {};
  console.log(`=== ${name} (status=${last.executionStatus ?? '?'}) ===`);
  if (last.error) console.log(`ERROR: ${last.error.message}\n`);
  for (const item of last.data?.main?.[0] ?? []) {
    console.log(`item keys: ${Object.keys(item.json ?? {}).join(', ')}`);
    console.log(`value: ${redact(item.json)}\n`);
  }
  // HTTP nodes surface the outgoing request body.
  if (last.source?.[0]?.previousNode) console.log(`from: ${last.source[0].previousNode}`);
}