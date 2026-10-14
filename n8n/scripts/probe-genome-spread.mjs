// Proves the anti-sameness engine produces DIFFERENT genomes for different seeds.
//
// Why this matters: the whole point of the platform is that two dental clinics do
// not get the same-looking site. A genome service that returns a constant would
// pass every health check while making every site identical - the exact failure
// this system exists to prevent, and one that no unit test would catch because it
// is a property of the live service plus its diversity ledger.
//
// Also probes /api/health so a schema or env regression surfaces here.
//
// Usage: node probe-genome-spread.mjs [calls]

const BASE = 'https://sites.anagataitsolutions.in';
const CALLS = Number(process.argv[2] ?? 3);
const OUT = process.env.TMPDIR ?? '.';

const health = await (await fetch(`${BASE}/api/health`)).json();
console.log('=== /api/health ===');
console.log('  status:', health.status, '| flags:', Object.entries(health.features ?? {}).filter(([, v]) => v).length + '/' + Object.keys(health.features ?? {}).length);
console.log('  missing env:', (health.missing_required_env ?? []).join(', ') || 'none');
console.log('');

console.log(`=== ${CALLS} genome calls, distinct seeds ===`);
const rows = [];

for (let i = 0; i < CALLS; i++) {
  const seed = `probe-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${BASE}/api/genome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed, niche: 'dental-clinic' }),
  });
  const genome = await res.json();
  if (res.status !== 200) {
    console.log(`  [FAIL] call ${i} -> HTTP ${res.status}: ${JSON.stringify(genome).slice(0, 200)}`);
    process.exitCode = 1;
    continue;
  }

  const g = genome.genome ?? {};
  const profile = genome.profile ?? g._profile ?? {};
  const fingerprint = [
    g.shell_archetype,
    g.nav_topology,
    g.color_mode,
    g.rhythm,
    g.grid ?? profile.grid,
    g.surface_treatment ?? profile.surface_treatment,
    g.motion_profile,
  ].join(' / ');

  rows.push({ seed: seed.slice(0, 18), fingerprint, similarity: genome.similarity, ok: genome.similarity_ok });
  console.log(`  ${i}: ${fingerprint}`);
  console.log(`     similarity=${genome.similarity} ok=${genome.similarity_ok}`);
}

console.log('');
const unique = new Set(rows.map((row) => row.fingerprint));
console.log(`distinct genomes: ${unique.size} of ${rows.length} calls`);

if (rows.length && unique.size === 1) {
  console.log('[FAIL] every call produced an IDENTICAL genome - the ledger is not diversifying');
  process.exitCode = 1;
} else if (rows.length) {
  console.log('[ok] genomes differ across seeds - anti-sameness is live');
}

const worst = Math.max(...rows.map((row) => Number(row.similarity?.score ?? row.similarity?.max ?? 0)));
console.log(`worst observed similarity: ${worst} (limit 0.45)`);
if (worst > 0.45) {
  console.log('[WARN] a genome exceeded the similarity limit but was still returned');
}