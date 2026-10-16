// Poll demo build progress via Supabase page counts (running n8n executions are
// hidden from the executions API until they finish, so the DB is the reliable
// signal). Exits 0 when both sites reach the target page count or when the
// site rows flip to live; exits 1 on timeout. Retries transient DNS errors.
import { readFileSync } from 'node:fs';
import https from 'node:https';

const env = JSON.parse(
  readFileSync('C:/Users/sanje/OneDrive/Desktop/Anagata Business workflows automation/anagata-web-engine/.engine-secrets.local', 'utf8')
);
const rest = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const TARGET = ['apex-talent-partners', 'surya-solar-solutions'];

function get(url, headers = H) {
  return new Promise((res, rej) => {
    const r = https.request(new URL(url), { headers }, (x) => {
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => {
        try { res(JSON.parse(d || 'null')); } catch { res(d); }
      });
    });
    r.on('error', rej);
    r.setTimeout(20000, () => r.destroy(new Error('timeout')));
    r.end();
  });
}

let lastSig = '';
let stableCount = 0;
for (let i = 0; i < 60; i++) {
  try {
    const sites = await get(rest + '/sites?select=id,slug,status');
    const lines = [];
    let allDone = true;
    for (const s of sites.filter((x) => TARGET.includes(x.slug))) {
      const pages = await get(rest + `/pages?site_id=eq.${s.id}&select=slug,published`);
      const pub = pages.filter((p) => p.published).length;
      lines.push(`${s.slug}:${pages.length}p/${pub}pub/${s.status}`);
      // done heuristic: >=15 pages and site status live (workflow flips it at the end)
      if (!(pages.length >= 15 && s.status === 'live')) allDone = false;
    }
    const sig = lines.join(' | ');
    if (sig !== lastSig) {
      console.log(new Date().toISOString().slice(11, 19), sig);
      lastSig = sig;
      stableCount = 0;
    } else {
      stableCount++;
    }
    if (allDone) {
      console.log('BOTH FINISHED:', sig);
      process.exit(0);
    }
    // no DB movement for 12+ polls (~18min) => stalled
    if (stableCount >= 12) {
      console.log('STALLED (no DB writes for ~18min):', sig);
      process.exit(2);
    }
  } catch (e) {
    console.log(new Date().toISOString().slice(11, 19), 'net err:', e.message);
  }
  await new Promise((r) => setTimeout(r, 90000));
}
console.log('TIMEOUT after 90min');
process.exit(1);