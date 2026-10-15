// Fire two demo site generations at the v3 webhook. Fire-and-forget: the
// webhook returns only when the whole site is done (6-12 min), so this script
// just triggers both and lets n8n run. Poll n8n's execution record after.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';

const URL = 'https://n8n.anagataitsolutions.in/webhook/nextjs-site-generator-v3';
const OUT = 'C:/Users/sanje/AppData/Local/hermes/cache/scratch';

const DEMOS = [
  {
    label: 'recruitment',
    body: {
      business_name: 'Apex Talent Partners',
      niche: 'recruitment agency',
      city: 'Mumbai',
      phone: '+912****1234',
      services: ['Executive Search', 'Contract Staffing', 'HR Consulting'],
      doctor_or_lead: { name: 'Priya Nair', credentials: '15 years in tech hiring' },
    },
  },
  {
    label: 'solar',
    body: {
      business_name: 'Surya Solar Solutions',
      niche: 'solar agency',
      city: 'Jaipur',
      phone: '+911****6677',
      services: ['Rooftop Solar Installation', 'Solar Maintenance', 'Net Metering Support'],
      doctor_or_lead: { name: 'Rajesh Sharma', credentials: 'MNRE certified installer' },
    },
  },
];

mkdirSync(OUT, { recursive: true });

for (const demo of DEMOS) {
  const bodyPath = `${OUT}/trigger-${demo.label}.json`;
  writeFileSync(bodyPath, JSON.stringify(demo.body));
  console.log(`[${demo.label}] triggering -> ${URL}`);

  execFile(
    'curl',
    [
      '-s', '-m', '20',
      '-X', 'POST', URL,
      '-H', 'Content-Type: application/json',
      '--data-binary', `@${bodyPath}`,
      '-o', `${OUT}/trigger-${demo.label}.out.txt`,
      '-w', '%{http_code}',
    ],
    (err, stdout) => {
      // 200 = synchronous (site already done, ~instant, impossible here);
      // 500/timeout after ~20s just means n8n accepted and is running.
      console.log(`[${demo.label}] trigger exit=${err ? err.code : 0} http=${stdout || 'n/a'}`);
    }
  );
}
console.log('both triggers sent; poll n8n executions in ~8-15 min');