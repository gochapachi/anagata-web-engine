// Writes .engine-secrets.local with the runtime config the workflow generator
// inlines into the two n8n workflow definitions.
//
// Secrets are read from the Coolify env API (the values the engine container
// already uses), so they never pass through argv, shell history or the chat. The
// file is gitignored.
//
// Usage: COOLIFY_TOKEN=... node n8n/scripts/write-workflow-config.mjs <engine-app-uuid>

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const outputPath = path.join(repoRoot, '.engine-secrets.local');

const TOKEN = process.env.COOLIFY_TOKEN;
const APP_UUID = process.argv[2] ?? 'lobduk7jaqkpnygj50f1snzo';

if (!TOKEN) {
  console.error('COOLIFY_TOKEN is required.');
  process.exit(2);
}

/** Reads the app's env vars from Coolify; returns a {KEY: value} map. */
async function readCoolifyEnv(appUuid) {
  const response = await fetch(
    `https://server.anagataitsolutions.in/api/v1/applications/${appUuid}/envs`,
    { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } }
  );
  if (!response.ok) {
    throw new Error(`could not read envs: HTTP ${response.status}`);
  }
  const payload = await response.json();
  const list = Array.isArray(payload) ? payload : (payload.data ?? {});
  /** @type {Record<string,string>} */
  const map = {};
  // Keep the FIRST occurrence of each key: a duplicate from an earlier partial
  // bulk write must not silently override the good value.
  for (const entry of [].concat(list)) {
    if (entry?.key && !(entry.key in map)) map[entry.key] = String(entry.value ?? '');
  }
  return map;
}

const coolifyEnv = await readCoolifyEnv(APP_UUID);

// Preserve an existing revalidate secret so the engine container and the
// workflows never drift apart - the engine was deployed with its own value.
const existing = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf8')) : {};

const config = {
  ENGINE_URL: 'https://sites.anagataitsolutions.in',
  SUPABASE_URL: coolifyEnv.SUPABASE_URL ?? 'https://supabase.anagataitsolutions.in',
  SUPABASE_SERVICE_ROLE_KEY: coolifyEnv.SUPABASE_SERVICE_ROLE_KEY ?? '',
  ENGINE_REVALIDATE_SECRET:
    existing.ENGINE_REVALIDATE_SECRET || coolifyEnv.ENGINE_REVALIDATE_SECRET || '',
  ENGINE_COMPILE_SECRET: coolifyEnv.ENGINE_COMPILE_SECRET ?? '',
  SITES_BASE_DOMAIN: coolifyEnv.SITES_BASE_DOMAIN ?? 'sites.anagataitsolutions.in',
  N8N_WEBHOOK_BASE: 'https://n8n.anagataitsolutions.in/webhook',
  _generated_at: new Date().toISOString(),
  _note: 'Gitignored. Inlined into the n8n workflow definitions by build-workflows.mjs.',
};

writeFileSync(outputPath, JSON.stringify(config, null, 2), 'utf8');

console.log('wrote .engine-secrets.local');
for (const [key, value] of Object.entries(config)) {
  if (key.startsWith('_')) continue;
  const shown = /SECRET|KEY|PASSWORD|TOKEN/i.test(key) ? `<${String(value).length} chars>` : value;
  console.log(`  ${key.padEnd(28)} = ${shown}`);
}

const missing = ['SUPABASE_SERVICE_ROLE_KEY', 'ENGINE_REVALIDATE_SECRET'].filter((k) => !config[k]);
if (missing.length) {
  console.error(`\n[FAIL] missing values: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('\nall required values present; ready to regenerate the workflows');