// Activates (or deactivates) the Next.js multi-tenant workflows.
//
// Workflows are resolved BY NAME, never by hardcoded id: busting n8n's stale
// in-memory graph cache means creating a brand-new workflow, which means a new
// id every time. Editing this file on each cache-bust was the old failure mode.
//
// Usage:
//   node n8n/scripts/activate-workflows.mjs                 # activate the v2 pair
//   node n8n/scripts/activate-workflows.mjs --deactivate    # deactivate them
//   node n8n/scripts/activate-workflows.mjs --suffix v1     # target the old pair
//
// The two WordPress workflows are snapshotted before and after; if either
// changes, this exits 1.

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://n8n.anagataitsolutions.in';

/** Which generation to touch. Must match the names build-workflows.mjs emits. */
const SUFFIX = (() => {
  const i = process.argv.indexOf('--suffix');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'v2';
})();

const SITE_BUILDER_NAME = `Anagata Next.js Multi-Tenant Site Builder (${SUFFIX})`;
const BLOG_PUBLISHER_NAME = `Anagata Next.js Multi-Tenant Blog Publisher (${SUFFIX})`;

const WORKFLOW_NAMES = [
  [SITE_BUILDER_NAME, 'site-builder'],
  [BLOG_PUBLISHER_NAME, 'blog-publisher'],
];

// Never touch these: snapshotted before and after so a mistake is loud.
const PROTECTED = [
  ['TUPLn7UxLhQyYXi0', 'WP site builder'],
  ['KEy18W9aUN0bnZTG', 'WP blog automation'],
];

function resolveKey() {
  if (process.env.N8N_API_KEY) return process.env.N8N_API_KEY;
  const configPath = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml');
  const match = readFileSync(configPath, 'utf8').match(/N8N_API_KEY:\s*(\S+)/);
  if (!match) throw new Error('N8N_API_KEY not found in config.yaml or environment');
  return match[1];
}

const KEY = resolveKey();
const deactivate = process.argv.includes('--deactivate');

async function api(pathname, init = {}) {
  const response = await fetch(`${BASE}/api/v1${pathname}`, {
    ...init,
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

/**
 * Names -> ids. Paginates because GET /workflows is capped at 100 rows per page
 * on this instance; an incomplete scan would look like "workflow missing".
 */
async function resolveWorkflows() {
  const all = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await api(`/workflows?${query}`);
    if (!res.ok) {
      throw new Error(`list workflows -> HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    const body = res.data ?? {};
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    all.push(...rows);
    // n8n's list response carries `nextCursor` and NO `hasNext` field. Keying the
    // loop off hasNext broke after page 1, so a workflow created moments ago -
    // which sorts past row 100 - was reported as missing. Advance on nextCursor.
    cursor = Array.isArray(body) ? undefined : body.nextCursor;
    if (!cursor || !rows.length) break;
  }

  return WORKFLOW_NAMES.map(([name, label]) => {
    const match = all.find((w) => w.name === name);
    if (!match) {
      throw new Error(
        `no workflow named "${name}" (scanned ${all.length} workflows). ` +
          'Run deploy-new-workflows.mjs first, or pass --suffix to target another generation.'
      );
    }
    return [match.id, label];
  });
}

async function snapshotProtected() {
  const map = new Map();
  for (const [id] of PROTECTED) {
    const res = await api(`/workflows/${id}`);
    map.set(id, {
      active: res.data?.active,
      nodes: res.data?.nodes?.length,
      updatedAt: res.data?.updatedAt,
    });
  }
  return map;
}

const WORKFLOWS = await resolveWorkflows();
console.log(`generation: ${SUFFIX}`);
for (const [id, label] of WORKFLOWS) console.log(`  ${label.padEnd(16)} ${id}`);
console.log('');

const before = await snapshotProtected();

for (const [id, label] of WORKFLOWS) {
  const action = deactivate ? 'deactivate' : 'activate';
  const res = await api(`/workflows/${id}/${action}`, { method: 'POST' });
  const active = res.data?.active === true;

  if (res.ok && (deactivate ? !active : active)) {
    console.log(`OK    ${label.padEnd(16)} ${action}d (${id})`);
  } else if (res.ok) {
    console.log(`?     ${label.padEnd(16)} HTTP 200 but active=${active}`);
  } else {
    console.log(`FAIL  ${label.padEnd(16)} HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 220)}`);
  }
}

console.log('');
const after = await snapshotProtected();
let changed = false;
for (const [id, label] of PROTECTED) {
  const a = before.get(id);
  const b = after.get(id);
  const same = a.active === b.active && a.nodes === b.nodes && a.updatedAt === b.updatedAt;
  if (!same) changed = true;
  console.log(
    `${same ? 'GUARD' : 'CHANGED'} ${label.padEnd(18)} active=${b.active} nodes=${b.nodes} updatedAt=${b.updatedAt}`
  );
}

console.log('');
for (const [id, label] of WORKFLOWS) {
  const res = await api(`/workflows/${id}`);
  console.log(`      ${label.padEnd(16)} active=${res.data?.active} nodes=${res.data?.nodes?.length}`);
}

if (changed) {
  console.error('\n[FAIL] a PROTECTED workflow changed. Investigate.');
  process.exit(1);
}
console.log('\n[OK] protected workflows unchanged.');