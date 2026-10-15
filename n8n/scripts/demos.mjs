// Demo generator. Runs one or two niche demos through the live site-builder
// webhook and reports the execution, so the quality of the output can be
// inspected against the rendered site rather than against the HTTP code.
//
//   node demos.mjs            -> both demos, in parallel
//   node demos.mjs re         -> real estate only
//   node demos.mjs tax        -> tax only
//
// Output is mirrored to demos.log beside this script. The bash background
// harness on this host loses stdout whenever the command contains a pipe
// (tee), and a multi-minute run whose output vanishes is indistinguishable
// from a crash - which is exactly what happened on the first attempt.
import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LOG = join(dirname(fileURLToPath(import.meta.url)), 'demos.log');
writeFileSync(LOG, `# demos started ${new Date().toISOString()}\n`);
function say(...args) {
  const line = args.join(' ');
  console.log(line);
  try {
    appendFileSync(LOG, line + '\n');
  } catch {
    /* logging must never break the run */
  }
}

const URL = 'https://n8n.anagataitsolutions.in/webhook/nextjs-site-generator-v3';

const DEMOS = {
  re: {
    label: 'real-estate',
    slug: 'meridian-property',
    body: {
      business_name: 'Meridian Property Group',
      niche: 'real estate agency',
      city: 'Pune',
      phone: '+912012345678',
      services: ['Residential Sales', 'Property Valuation', 'Landlord Services', 'Luxury Rentals'],
      doctor_or_lead: { name: 'Rohan Deshpande', credentials: 'RERA registered, 12 years in Pune residential' },
      custom_domain: 'meridian-property.example.com',
    },
  },
  tax: {
    label: 'tax',
    slug: 'ledgerline-tax',
    body: {
      business_name: 'Ledgerline Tax Advisors',
      niche: 'tax agency',
      city: 'Pune',
      phone: '+912023456789',
      services: ['Personal Tax Returns', 'Company Accounts', 'Tax Planning', 'Investigation Support'],
      doctor_or_lead: { name: 'Anita Kulkarni', credentials: 'ACA, 15 years in practice' },
      custom_domain: 'ledgerline-tax.example.com',
    },
  },
};

async function run(demo) {
  const t0 = Date.now();
  const tmpBody = join(dirname(fileURLToPath(import.meta.url)), `.demo-${demo.label}.json`);
  const tmpOut = join(dirname(fileURLToPath(import.meta.url)), `.demo-${demo.label}.out.json`);
  writeFileSync(tmpBody, JSON.stringify(demo.body));
  say(`\n[${demo.label}] POST -> webhook (${new Date().toISOString()})`);
  await new Promise((resolve) => {
    execFile(
      'curl',
      ['-s', '-m', '900', '-X', 'POST', URL,
        '-H', 'Content-Type: application/json',
        '--data-binary', `@${tmpBody}`,
        '-o', tmpOut,
        '-w', 'HTTP %{http_code} | %{time_total}s'],
      { timeout: 960_000 },
      (err, stdout) => {
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (err) {
          say(`[${demo.label}] CURL ERROR after ${secs}s: ${err.message}`);
          resolve();
          return;
        }
        say(`[${demo.label}] ${String(stdout).trim()}`);
        try {
          const j = JSON.parse(readFileSync(tmpOut, 'utf8'));
          say(`  status        : ${j.status}`);
          say(`  slug          : ${j.slug}`);
          say(`  pages         : ${j.pages_generated} generated, ${j.pages_salvaged} salvaged`);
          say(`  preview       : ${j.preview_url}`);
          if (j.design) say(`  design        : ${JSON.stringify(j.design)}`);
        } catch {
          say('  body:', readFileSync(tmpOut, 'utf8').slice(0, 600));
        }
        resolve();
      }
    );
  });
}

const which = process.argv[2];
const targets = which ? [DEMOS[which]].filter(Boolean) : Object.values(DEMOS);
if (!targets.length) {
  console.error('usage: node demos.mjs [re|tax]');
  process.exit(1);
}
await Promise.all(targets.map(run));
console.log('\ndone.');