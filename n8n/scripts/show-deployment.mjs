// Fetches a Coolify deployment and prints its human-readable log tail.
//
// Coolify returns deployment logs as a JSON-encoded array of
// {command, output, type, timestamp} records inside a single string, so the
// useful text has to be unwrapped before it can be read. This script also
// redacts anything that looks like a credential.
//
// Usage: COOLIFY_TOKEN=... node n8n/scripts/show-deployment.mjs <deployment-uuid> [tail-lines]

const TOKEN = process.env.COOLIFY_TOKEN;
const DEPLOY_UUID = process.argv[2];
const TAIL = Number(process.argv[3] ?? 40);

if (!TOKEN || !DEPLOY_UUID) {
  console.error('usage: COOLIFY_TOKEN=... node n8n/scripts/show-deployment.mjs <deployment-uuid> [tail-lines]');
  process.exit(2);
}

const response = await fetch(`https://server.anagataitsolutions.in/api/v1/deployments/${DEPLOY_UUID}`, {
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
});

const deployment = await response.json();
console.log(`status   : ${deployment.status}`);
console.log(`finished : ${deployment.finished_at ?? '-'}`);
console.log('');

/** Unwraps the nested log structure into plain lines. */
function toLines(raw) {
  if (typeof raw !== 'string') return [];

  // Preferred path: it is a JSON array of log records.
  const start = raw.indexOf('[');
  if (start !== -1) {
    try {
      const records = JSON.parse(raw.slice(start));
      if (Array.isArray(records)) {
        return records
          .map((record) => String(record?.output ?? record?.command ?? ''))
          .join('\n')
          .split('\n');
      }
    } catch {
      /* fall through to the regex path */
    }
  }

  // Fallback: pull every "output":"..." string out of the blob.
  const out = [];
  const pattern = /"output"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) out.push(match[1]);
  return out.join('\n').split('\n');
}

const ANSI = /\u001b\[[0-9;]*m/g;
const lines = toLines(deployment.logs ?? '')
  .map((line) => line.replace(ANSI, '').replace(/\\n/g, '\n').trim())
  .filter(Boolean);

console.log(`=== last ${TAIL} lines ===`);
for (const line of lines.slice(-TAIL)) {
  const safe = line
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '<jwt>')
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|ENGINE_REVALIDATE_SECRET)=\S+/g, '$1=<redacted>');
  console.log('  ' + safe.slice(0, 170));
}

// Surface the actual failure reason, which Coolify buries mid-log.
const failures = lines.filter((line) => /error|failed|npm ERR|exit code|not found|cannot/i.test(line));
if (failures.length) {
  console.log('');
  console.log('=== error-ish lines ===');
  for (const line of failures.slice(-12)) console.log('  ' + line.replace(ANSI, '').slice(0, 170));
}