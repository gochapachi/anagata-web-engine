// Print the region of the deployed 'Build Page Blueprints' jsCode around the
// niche page sets, so the syntax error can be read directly instead of guessed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfg = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'config.yaml');
const KEY = fs.readFileSync(cfg, 'utf8').match(/N8N_API_KEY:\s*(\S+)/)[1];
const BASE = 'https://n8n.anagataitsolutions.in/api/v1';

const res = await fetch(`${BASE}/workflows/WSOqHU23S4Ea34EL`, {
  headers: { 'X-N8N-API-KEY': KEY },
});
const wf = await res.json();
const node = wf.nodes.find((n) => n.name === 'Build Page Blueprints');
const code = node.parameters.jsCode;
fs.writeFileSync('n8n/scripts/_deployed-blueprint.js', code);
console.log('jsCode bytes:', code.length, '-> written to n8n/scripts/_deployed-blueprint.js');

// Show the niche block with line numbers so the bad line is identifiable.
const lines = code.split('\n');
const start = lines.findIndex((l) => l.includes('NICHE_PAGES'));
const from = Math.max(0, start - 4);
const to = Math.min(lines.length, start + 45);
console.log(`\n--- lines ${from + 1}..${to} ---`);
for (let i = from; i < to; i++) {
  console.log(String(i + 1).padStart(4) + '| ' + lines[i]);
}

// Then actually try to parse it, so the failure is proven not inferred.
try {
  new Function(code);
  console.log('\n[PASS] deployed jsCode parses as JavaScript');
} catch (err) {
  console.log('\n[FAIL] deployed jsCode does NOT parse:', err.message);
  // Bisect: find the first line that breaks the parse when appended.
  for (let i = 1; i <= lines.length; i++) {
    try {
      new Function(lines.slice(0, i).join('\n'));
    } catch {
      console.log('   parse first breaks at line', i, ':', lines[i - 1].trim().slice(0, 160));
      break;
    }
  }
}