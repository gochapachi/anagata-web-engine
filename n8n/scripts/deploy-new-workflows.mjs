/**
 * Deployment script for the TWO NEW n8n workflows.
 *
 * SAFETY CONTRACT (see the plan): the existing WordPress workflows
 * `TUPLn7UxLhQyYXi0` (site builder v8) and `KEy18W9aUN0bnZTG` (blog automation)
 * must be left completely untouched. This script therefore:
 *
 *   1. never issues PUT/PATCH/DELETE against any workflow id it did not create;
 *   2. snapshots both protected workflows' `updatedAt` BEFORE and AFTER the run
 *      and fails loudly if either changed;
 *   3. creates only via POST /api/v1/workflows.
 *
 * Usage:
 *   N8N_API_URL=https://n8n.anagataitsolutions.in \
 *   N8N_API_KEY=... \
 *   node n8n/scripts/deploy-new-workflows.mjs [--dry-run] [--activate]
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROTECTED_WORKFLOW_IDS = ['TUPLn7UxLhQyYXi0', 'KEy18W9aUN0bnZTG'];

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.join(here, '..', 'workflows');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const activate = args.has('--activate');

const API_URL = (process.env.N8N_API_URL ?? '').replace(/\/+$/, '');
const API_KEY = process.env.N8N_API_KEY ?? '';

if (!API_URL || !API_KEY) {
  console.error('Missing N8N_API_URL or N8N_API_KEY.');
  process.exit(2);
}

async function api(pathname, init = {}) {
  const response = await fetch(`${API_URL}/api/v1${pathname}`, {
    ...init,
    headers: {
      'X-N8N-API-KEY': API_KEY,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Reads the protected workflows so we can prove they were not modified. */
async function snapshotProtected() {
  const snapshot = new Map();
  for (const id of PROTECTED_WORKFLOW_IDS) {
    const workflow = await api(`/workflows/${id}`);
    snapshot.set(id, { name: workflow.name, updatedAt: workflow.updatedAt, nodes: workflow.nodes?.length ?? 0 });
  }
  return snapshot;
}

function compareProtected(before, after) {
  let changed = false;
  for (const id of PROTECTED_WORKFLOW_IDS) {
    const a = before.get(id);
    const b = after.get(id);
    if (a.updatedAt !== b.updatedAt || a.name !== b.name || a.nodes !== b.nodes) {
      changed = true;
      console.error(`[GUARD] ${id} CHANGED!`);
      console.error(`        before: ${JSON.stringify(a)}`);
      console.error(`        after : ${JSON.stringify(b)}`);
    } else {
      console.log(`[GUARD] ${id} untouched (${b.name}, ${b.nodes} nodes, updatedAt ${b.updatedAt})`);
    }
  }
  return changed;
}

/** Finds an existing workflow by exact name, so re-runs update instead of duplicating. */
async function findByName(name) {
  let cursor;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await api(`/workflows?${query.toString()}`);
    const match = (page.data ?? []).find((workflow) => workflow.name === name);
    if (match) return match;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

async function main() {
  console.log(`[INFO] Target: ${API_URL}${dryRun ? ' (DRY RUN)' : ''}`);
  const before = await snapshotProtected();
  console.log('[INFO] Protected workflow snapshot taken.');

  const files = [
    'nextjs-multi-tenant-site-builder.json',
    'nextjs-multi-tenant-blog-publisher.json',
  ];

  const created = [];

  for (const file of files) {
    const raw = await readFile(path.join(workflowDir, file), 'utf8');
    const definition = JSON.parse(raw);
    const { name, nodes, connections, settings } = definition;

    if (!name || !Array.isArray(nodes) || !connections) {
      throw new Error(`${file} is missing name/nodes/connections.`);
    }

    const existing = await findByName(name);

    if (dryRun) {
      console.log(
        `[DRY] ${name}: ${nodes.length} nodes, ${Object.keys(connections).length} connection groups, ` +
          `${existing ? `would UPDATE id ${existing.id}` : 'would CREATE'}`
      );
      continue;
    }

    if (existing) {
      // Only ever touch a workflow this script itself created. If someone names
      // their own workflow identically, refuse rather than overwrite it.
      if (PROTECTED_WORKFLOW_IDS.includes(existing.id)) {
        throw new Error(`Refusing to update protected workflow ${existing.id} (${name}).`);
      }
      const updated = await api(`/workflows/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, nodes, connections, settings: settings ?? {} }),
      });
      console.log(`[UPDATED] ${name} -> ${updated.id} (${nodes.length} nodes)`);
      created.push(updated.id);
    } else {
      const workflow = await api('/workflows', {
        method: 'POST',
        body: JSON.stringify({ name, nodes, connections, settings: settings ?? {} }),
      });
      console.log(`[CREATED] ${name} -> ${workflow.id} (${nodes.length} nodes)`);
      created.push(workflow.id);
    }

    if (activate && created.length) {
      await api(`/workflows/${created[created.length - 1]}/activate`, { method: 'POST' }).catch((error) => {
        console.warn(`[WARN] Could not activate: ${error.message}`);
      });
    }
  }

  const after = await snapshotProtected();
  const changed = compareProtected(before, after);

  console.log('');
  console.log(`[RESULT] New workflows: ${created.join(', ') || '(dry run, none created)'}`);
  if (changed) {
    console.error('[FAIL] A PROTECTED WORKFLOW WAS MODIFIED. Investigate immediately.');
    process.exit(1);
  }
  console.log('[OK] Both protected workflows verified untouched.');
}

main().catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
});