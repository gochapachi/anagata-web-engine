// Tests whether `$env` is usable inside n8n expressions on this instance.
//
// WHY THIS MATTERS: the service sets N8N_BLOCK_ENV_ACCESS_IN_NODE=true, which is
// documented to block `$env` in expressions for security. If it does, both new
// workflows would fail on their first HTTP node, because they read
// $env.ENGINE_URL / $env.SUPABASE_URL / $env.SUPABASE_SERVICE_ROLE_KEY.
//
// The test is deliberately cheap and self-cleaning: create a one-node workflow
// whose Set node evaluates $env.N8N_ENCRYPTION_KEY (a value only n8n itself can
// resolve), run it, read the result, then DELETE the workflow. Nothing else is
// touched and no persistent artifact is left behind.
//
// Usage: N8N_API_KEY=... N8N_BASE_URL=... node n8n/scripts/probe-env-access.mjs

const KEY = process.env.N8N_API_KEY;
const BASE = (process.env.N8N_BASE_URL ?? 'https://n8n.anagataitsolutions.in').replace(/\/+$/, '');

if (!KEY) {
  console.error('N8N_API_KEY is required.');
  process.exit(2);
}

const HEADERS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

async function api(path, init = {}) {
  const response = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) } });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

let workflowId = null;

try {
  // A manual trigger -> Set node whose value is an expression reading $env.
  const created = await api('/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: `zz-probe-env-access-${Date.now()}`,
      nodes: [
        {
          parameters: {},
          id: 'probe-trigger',
          name: 'Manual',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [0, 0],
        },
        {
          parameters: {
            assignments: {
              assignments: [
                { id: 'a1', name: 'probe', value: '={{ $env.N8N_ENCRYPTION_KEY }}', type: 'string' },
              ],
            },
            options: {},
          },
          id: 'probe-set',
          name: 'ReadEnv',
          type: 'n8n-nodes-base.set',
          typeVersion: 3.4,
          position: [220, 0],
        },
      ],
      connections: { Manual: { main: [[{ node: 'ReadEnv', type: 'main', index: 0 }]] } },
      settings: { executionOrder: 'v1' },
    }),
  });

  if (!created.ok) {
    console.error(`could not create probe workflow: HTTP ${created.status} ${JSON.stringify(created.data).slice(0, 300)}`);
    process.exit(1);
  }
  workflowId = created.data.id;
  console.log(`probe workflow created: ${workflowId}`);

  // Run it. Use the public API's test endpoint; if unavailable, execute via the
  // workflow's own test URL is not possible without a webhook, so report clearly.
  const run = await api(`/workflows/${workflowId}/run`, { method: 'POST' });
  if (!run.ok) {
    console.log(`\nCould not execute via API (HTTP ${run.status}).`);
    console.log('n8n public API has no generic "execute workflow" endpoint on this version,');
    console.log('so $env behaviour must be checked by a manual run in the editor.');
    process.exit(0);
  }

  const value = run.data?.data?.resultData?.runData?.ReadEnv?.[0]?.data?.main?.[0]?.[0]?.json?.probe;
  if (typeof value === 'string' && value.length > 0) {
    console.log(`\nRESULT: $env RESOLVES -> got a ${value.length}-char value.`);
    console.log('EITHER N8N_BLOCK_ENV_ACCESS_IN_NODE does not block $env on this version,');
    console.log('or $env access is permitted. The workflows can use $env.');
  } else {
    console.log('\nRESULT: $env did NOT resolve (empty or missing).');
    console.log('The workflows will need literal values or a different config source.');
  }
} catch (error) {
  console.error(`ERROR ${error.message}`);
} finally {
  if (workflowId) {
    const deleted = await api(`/workflows/${workflowId}`, { method: 'DELETE' });
    console.log(`\nprobe workflow deleted: ${deleted.ok ? 'yes' : `NO (HTTP ${deleted.status}) - id ${workflowId}`}`);
  }
}