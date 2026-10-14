// Removes the broken (v2) workflow pair, whose node ids exceeded n8n's
// varchar(36) limit and put it into an infinite "value too long for type
// character varying(36)" retry loop on every activation.
//
// Deactivate FIRST: the error only fires for ACTIVE workflows, so stopping
// activation stops the loop immediately, before any deletion happens.
//
// The two WordPress workflows are protected by name-pattern guard and are never
// under consideration for deletion.
//
// Usage:
//   node n8n/scripts/retire-workflows.mjs --suffix v2 --delete
//   node n8n/scripts/retire-workflows.mjs --suffix v2            (deactivate only)

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUFFIX = (() => {
  const i = process.argv.indexOf('--suffix');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'v2';
})();
const DO_DELETE = process.argv.includes('--delete');

const TARGETS = [
  `Anagata Next.js Multi-Tenant Site Builder (${SUFFIX})`,
  `Anagata Next.js Multi-Tenant Blog Publisher (${SUFFIX})`,
];

// Never under consideration. A target matching one of these aborts the run.
const PROTECTED = [
  ['TUPLn7UxLhQyYXi0', 'WP site builder'],
  ['KEy18W9aUN0bnZTG', 'WP blog automation'],
];

const KEY =
  process.env.N8N_API_KEY ??
  readFileSync(path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml'), 'utf8').match(
    /N8N_API_KEY:\s*(\S+)/
  )?.[1];
if (!KEY) throw new Error('no N8N_API_KEY');

const BASE = 'https://n8n.anagataitsolutions.in';
const HDRS = { 'X-N8N-API-KEY': KEY, Accept: 'application/json', 'Content-Type': 'application/json' };

async function listWorkflows() {
  const all = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${BASE}/api/v1/workflows?limit=100${cursor ? `&cursor=${cursor}` : ''}`, { headers: HDRS });
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    all.push(...rows);
    cursor = Array.isArray(body) ? undefined : body.nextCursor;
    if (!cursor) break;
  }
  return all;
}

const all = await listWorkflows();

// Refuse to proceed if any target name is ambiguous or collides with protected work.
for (const name of TARGETS) {
  const matches = all.filter((w) => w.name === name);
  if (matches.length > 1) {
    console.error(`[ABORT] "${name}" matches ${matches.length} workflows (${matches.map((m) => m.id).join(', ')}).`);
    console.error('        Name the target explicitly; refusing to guess.');
    process.exit(1);
  }
  for (const [id] of PROTECTED) {
    if (matches.some((m) => m.id === id)) {
      console.error(`[ABORT] "${name}" resolves to PROTECTED workflow ${id}. Refusing.`);
      process.exit(1);
    }
  }
}

console.log('=== target workflows ===');
const found = [];
for (const name of TARGETS) {
  const match = all.find((w) => w.name === name);
  if (!match) {
    console.log(`  (none named "${name}")`);
    continue;
  }
  found.push(match);
  const long = (match.nodes ?? []).filter((n) => String(n.id).length > 36).length;
  console.log(`  ${match.name}`);
  console.log(`     id=${match.id} active=${match.active} nodes=${match.nodes?.length} ids_over_36_chars=${long}`);
}

if (!found.length) {
  console.log('\nnothing to retire');
  process.exit(0);
}

/* ------------------------------------------- protect: snapshot before/after */
const snapshot = async () => {
  const out = new Map();
  for (const [id] of PROTECTED) {
    const res = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: HDRS });
    if (!res.ok) continue;
    const wf = await res.json();
    out.set(id, `${wf.active}|${wf.nodes?.length}|${wf.updatedAt}`);
  }
  return out;
};

const before = await snapshot();

/* --------------------------------------------- step 1: deactivate (stops loop) */
console.log(`\n=== deactivate (stops the varchar(36) retry loop) ===`);
const ids = [];
for (const workflow of found) {
  const res = await fetch(`${BASE}/api/v1/workflows/${workflow.id}/deactivate`, {
    method: 'POST',
    headers: HDRS,
  });
  ids.push(workflow.id);
  const body = await res.text();
  console.log(`  ${res.ok ? 'OK  ' : 'FAIL'} ${workflow.name.padEnd(50)} -> ${res.status} ${body.slice(0, 80)}`);
}

/* --------------------------------------- step 2: delete the broken definitions */
if (DO_DELETE) {
  console.log(`\n=== delete ===`);
  for (const workflow of found) {
    const res = await fetch(`${BASE}/api/v1/workflows/${workflow.id}`, { method: 'DELETE', headers: HDRS });
    console.log(
      `  ${res.ok ? 'OK  ' : 'FAIL'} ${workflow.name.padEnd(50)} ${workflow.id} -> ${res.status}`
    );
  }
} else {
  console.log('\n(deactivate only - pass --delete to remove the definitions)');
}

/* ---------------------------------------------------- verify protected survived */
const after = await snapshot();
let changed = false;
console.log('\n=== protected workflows ===');
for (const [id] of PROTECTED) {
  const a = before.get(id);
  const b = after.get(id);
  const same = a === b;
  if (!same) changed = true;
  console.log(`  ${same ? 'GUARD' : 'CHANGED'} ${id}  ${b ?? '(deleted?!)'}`);
}
if (changed) {
  console.error('\n[FAIL] a PROTECTED workflow changed. Investigate immediately.');
  process.exit(1);
}
console.log('\n[OK] protected workflows unchanged.');