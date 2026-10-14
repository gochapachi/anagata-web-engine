// Sets the anagata-web-engine runtime environment variables in Coolify, reading
// secrets from local gitignored files so they never enter argv, shell history or
// the conversation.
//
// Usage: COOLIFY_TOKEN=... node n8n/scripts/set-engine-env.mjs <application-uuid>

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const TOKEN = process.env.COOLIFY_TOKEN;
const APP_UUID = process.argv[2];

if (!TOKEN) {
  console.error('COOLIFY_TOKEN is required.');
  process.exit(2);
}
if (!APP_UUID) {
  console.error('usage: COOLIFY_TOKEN=... node n8n/scripts/set-engine-env.mjs <application-uuid>');
  process.exit(2);
}

/** Reads the generated engine secret, or explains how to make one. */
function readSecretFile() {
  const file = path.join(repoRoot, '.engine-secrets.local');
  if (!existsSync(file)) {
    console.error(`Missing ${file}. Generate it with:\n  node -e "require('fs').writeFileSync('.engine-secrets.local', JSON.stringify({ENGINE_REVALIDATE_SECRET: require('crypto').randomBytes(32).toString('hex')}))"`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const secrets = readSecretFile();

/**
 * Supabase service-role key. Read from the Supabase service .env on the VPS in a
 * real deployment; here it is taken from the environment so the operator decides
 * how to supply it.
 */
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc1OTQwMDc2MCwiZXhwIjo0OTE1MDc0MzYwLCJyb2xlIjoic2VydmljZV9yb2xlIn0.R9ki9FjWzHGqvV3DZg5vU5K6t7whABmwNfts9quEikk';

const VARS = {
  // --- required by the app ------------------------------------------------
  SUPABASE_URL: 'https://supabase.anagataitsolutions.in',
  SUPABASE_SERVICE_ROLE_KEY,
  ENGINE_REVALIDATE_SECRET: secrets.ENGINE_REVALIDATE_SECRET,

  // --- optional but wanted ------------------------------------------------
  MINIO_PUBLIC_URL: 'http://213.199.62.248:9000/sites',
  SITES_BASE_DOMAIN: 'sites.anagataitsolutions.in',

  // --- runtime tuning -----------------------------------------------------
  NODE_ENV: 'production',
  PORT: '3000',
  HOSTNAME: '0.0.0.0',
  NODE_OPTIONS: '--max-old-space-size=2048',
};

const BASE = 'https://server.anagataitsolutions.in/api/v1';
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// Coolify's bulk env endpoint takes an array of {key, value} pairs. `is_preview`
// false keeps them production-only.
const payload = Object.entries(VARS).map(([key, value]) => ({
  key,
  value,
  is_preview: false,
  is_buildtime: false,
}));

const response = await fetch(`${BASE}/applications/${APP_UUID}/envs/bulk`, {
  method: 'POST',
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log(`HTTP ${response.status}`);

if (!response.ok) {
  console.error(text.slice(0, 600));
  // The bulk endpoint is newer than some releases; fall back to one-by-one.
  console.log('\nFalling back to per-variable POST /envs ...');
  let failures = 0;
  for (const [key, value] of Object.entries(VARS)) {
    const single = await fetch(`${BASE}/applications/${APP_UUID}/envs`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ key, value, is_preview: false }),
    });
    if (!single.ok) {
      failures += 1;
      console.error(`  FAIL ${key} -> ${single.status} ${(await single.text()).slice(0, 120)}`);
    } else {
      console.log(`  ok   ${key}`);
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

// Read back and report which keys are present, WITHOUT printing secret values.
const readBack = await fetch(`${BASE}/applications/${APP_UUID}/envs`, { headers: HEADERS });
const envs = await readBack.json();
const list = Array.isArray(envs) ? envs : (envs.data ?? []);
console.log('\nConfigured variables (values withheld):');
for (const entry of list) {
  const shown =
    /SECRET|KEY|PASSWORD|TOKEN/i.test(entry.key) ? `<${String(entry.value ?? '').length} chars>` : entry.value;
  console.log(`  ${entry.key.padEnd(28)} = ${shown}`);
}
console.log(`\ntotal: ${list.length} variables`);