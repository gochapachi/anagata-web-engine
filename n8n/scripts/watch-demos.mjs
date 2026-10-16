// Poll n8n until both demo webhook executions (started after `start` offset)
// reach a terminal status. Prints each poll; exits 0 when both done.
import { readFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const key = readFileSync(path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml'), 'utf8')
  .match(/N8N_API_KEY:\s*(\S+)/)[1];
const start = Date.now() - 120000; // include triggers fired just before watcher start

function poll() {
  return new Promise((res) => {
    const u = new URL('https://n8n.anagataitsolutions.in/api/v1/executions?limit=200');
    const req = https.request(u, { headers: { 'X-N8N-API-KEY': key } }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const mine = (j.data || []).filter(
            (e) =>
              e.workflowId === '9O3LBF83wAiwRAEA' &&
              e.mode === 'webhook' &&
              new Date(e.startedAt).getTime() > start
          );
          const done = mine.filter((e) => e.status !== 'running' && e.status !== 'new');
          console.log(
            new Date().toISOString().slice(11, 19),
            'webhook execs:',
            mine.map((e) => `${e.id}:${e.status}`).join(' ') || 'none yet'
          );
          res(done.length >= 2 ? done : null);
        } catch (err) {
          console.log('parse err', err.message);
          res(null);
        }
      });
    });
    req.on('error', (e) => {
      console.log('ERR', e.message);
      res(null);
    });
    req.end();
  });
}

for (let i = 0; i < 40; i++) {
  const done = await poll();
  if (done) {
    console.log('BOTH FINISHED:', JSON.stringify(done.map((e) => ({ id: e.id, status: e.status }))));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 45000));
}
console.log('TIMEOUT after 30min');
process.exit(1);