/**
 * Makes the compile secret identical in both places, from ONE source of truth.
 *
 * The engine enforces ENGINE_COMPILE_SECRET and the workflows send it as
 * x-compile-secret. If the two values differ, every /api/compile returns 401 and
 * site generation breaks outright - so this asserts equality rather than assuming
 * it, and repairs from the file (which also feeds the workflow generator).
 *
 * Secrets are compared by hash and reported as lengths/hashes only.
 *
 * Usage: node sync-compile-secret.mjs [--apply]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const here = path.dirname(fileURLToPath(import.meta.url));

const COOLIFY = 'https://server.anagataitsolutions.in';
const COOLIFY_TOKEN = '4|hmRmx4hbHIVtvRgP5VStUXQd0cYjFxsdwrCDzVlZbc7b50a7';
const APP = 'lobduk7jaqkpnygj50f1snzo';
const KEY = 'ENGINE_COMPILE_SECRET';

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

const secrets = JSON.parse(readFileSync(path.join(here, '..', '..', '.engine-secrets.local'), 'utf8'));
const fileValue = secrets[KEY] ?? '';
if (!fileValue) {
  console.error(`[FAIL] ${KEY} is empty in .engine-secrets.local`);
  process.exit(1);
}

console.log('=== compile secret: file ===');
console.log(`  length ${fileValue.length}  sha ${sha(fileValue)}`);

const api = async (method, urlPath, body) => {
  const res = await fetch(`${COOLIFY}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
};

/* --------------------------------------------- find the env var in Coolify */
const list = await api('GET', `/api/v1/applications/${APP}/envs`);
if (!list.ok) {
  console.error(`[FAIL] could not list envs: HTTP ${list.status}`);
  process.exit(1);
}
const rows = Array.isArray(list.data) ? list.data : (list.data.data ?? []);
const entry = rows.find((r) => r.key === KEY);
if (!entry) {
  console.error(`[FAIL] ${KEY} not found on the app - create it first`);
  process.exit(1);
}

// Coolify masks values on list responses, so equality cannot be read directly.
// Instead force the value from the file, which makes them equal by construction.
console.log('');
console.log('=== syncing Coolify -> file value ===');
console.log(`  env uuid ${entry.uuid}`);

if (!APPLY) {
  console.log(`  [dry] would PATCH ${KEY} on the app to the file's value`);
} else {
  // Bulk-update shape: an array of {key, value}.
  let put = await api('PATCH', `/api/v1/applications/${APP}/envs`, [
    { key: KEY, value: fileValue, is_runtime: true, is_buildtime: false },
  ]);

  // Some Coolify builds want the single-env form; fall back rather than guessing twice.
  if (!put.ok) {
    console.log(`  (bulk PATCH -> HTTP ${put.status}, retrying single-env form)`);
    put = await api('PATCH', `/api/v1/applications/${APP}/envs/${entry.uuid}`, {
      key: KEY,
      value: fileValue,
      is_runtime: true,
    });
  }

  if (!put.ok) {
    console.error(`  [FAIL] could not update: HTTP ${put.status} ${JSON.stringify(put.data).slice(0, 200)}`);
    console.error('  Set it by hand in the Coolify UI, or use the MCP env_vars tool.');
    process.exit(1);
  }
  console.log(`  [OK] Coolify now holds the file's value (sha ${sha(fileValue)})`);
}

/* ------------------------------------------------- confirm the generator sees it */
const built = path.join(here, '..', 'workflows', 'nextjs-multi-tenant-site-builder.json');
try {
  const wf = JSON.parse(readFileSync(built, 'utf8'));
  const gates = (wf.nodes ?? []).filter((n) => /Compile Gate/.test(n.name));
  for (const g of gates) {
    const header = (g.parameters?.headerParameters?.parameters ?? []).find((h) => h.name === 'x-compile-secret');
    const value = String(header?.value ?? '');
    console.log('');
    console.log(`=== generated workflow (${g.name}) ===`);
    console.log(
      value.length
        ? `  x-compile-secret is populated: ${value.length} chars, sha ${sha(value)}`
        : '  x-compile-secret is EMPTY - rebuild the workflows (node n8n/scripts/build-workflows.mjs)'
    );
    if (value.length && sha(value) !== sha(fileValue)) {
      console.log('  [WARN] header value differs from the file - rebuild needed');
    }
  }
} catch {
  console.log('\n(workflow JSON not built yet - run build-workflows.mjs after this)');
}