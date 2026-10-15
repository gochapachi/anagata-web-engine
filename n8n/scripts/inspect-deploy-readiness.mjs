// Inspect deployment readiness: does the generated workflow carry the craft
// layer, motion component rules, and non-dental niche support?
import fs from 'node:fs';

const SITE = 'n8n/workflows/nextjs-multi-tenant-site-builder.json';
const BLOG = 'n8n/workflows/nextjs-multi-tenant-blog-publisher.json';

const report = (label, path, probes) => {
  if (!fs.existsSync(path)) {
    console.log(`${label}: MISSING (${path})`);
    return;
  }
  const raw = fs.readFileSync(path, 'utf8');
  const wf = JSON.parse(raw);
  console.log(`\n=== ${label} ===`);
  console.log(`nodes: ${wf.nodes.length}`);
  for (const [name, re] of Object.entries(probes)) {
    console.log(`${re.test(raw) ? 'YES' : 'no '}  ${name}`);
  }
};

const common = {
  'motion primitives named (Reveal/Parallax/StatCounter/TiltCard/StickyScene)':
    /Reveal|Parallax|StatCounter|TiltCard|StickyScene|ScrollProgress|Marquee/,
  'craft/design-skill injection present': /design_skill|designBrief|DESIGN CRAFT|craft/i,
  "HARD RULE 6 still says 'Never use any other component'": /Never use any other component/i,
  'real-estate niche referenced': /real[- ]?estate|realtor|property/i,
  'tax/accounting niche referenced': /tax[- ]?(agency|firm|consult)|accounting|CA\b/i,
};

report('SITE BUILDER', SITE, common);
report('BLOG PUBLISHER', BLOG, common);

// Which component names does the prompt allow the agent to emit?
const wf = JSON.parse(fs.readFileSync(SITE, 'utf8'));
for (const n of wf.nodes) {
  const code = n.parameters?.jsCode || n.parameters?.text || '';
  if (/component/i.test(code) && /Hero|Testimonial|FAQ/i.test(code)) {
    const m = code.match(/(?:ALLOWED|APPROVED|available|use only)[^\n]{0,400}/i);
    console.log(`\n--- component rule in node "${n.name}" ---`);
    console.log(m ? m[0].slice(0, 400) : '(no allowlist sentence found)');
  }
}