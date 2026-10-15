/**
 * Injects a motion-rich homepage into an existing test tenant so the motion
 * primitives can be measured in a real browser.
 *
 * This is a TEST FIXTURE, not the generator: it writes MDX that exercises every
 * primitive in src/components/motion, so probe-motion.mjs has real animated
 * content to assert against. The workflow will produce this content itself once
 * the prompt is taught the component vocabulary.
 *
 * Usage: node n8n/scripts/seed-motion-page.mjs <site-slug>
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2] ?? 'auth-verify-dental';
const here = path.dirname(fileURLToPath(import.meta.url));
const secrets = JSON.parse(
  readFileSync(path.join(here, '..', '..', '.engine-secrets.local'), 'utf8')
);
const URL_ = secrets.SUPABASE_URL.replace(/\/+$/, '');
const H = {
  apikey: secrets.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${secrets.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

/* ------------------------------------------------------------------ content */

// Exercises each primitive. Written the way the agent will be instructed to:
// component name + serialisable props, no markup invention.
const HOME_MDX = `
<ScrollProgress />

<section className="shell-section">
  <p className="shell-eyebrow">Verified implantology</p>
  <h1 className="shell-display">Single-visit root canal treatment with microscope precision</h1>
  <p className="shell-body">Every case is planned from a 3D scan and finished under magnification, so you keep more of your natural tooth and need fewer sittings.</p>
  <InlineLeadCTA ctaText="Book a consultation" service="Microscope-assisted RCT" phone="+919999900011" />
</section>

<Reveal from="bottom" stagger={0.12}>
  <h2>Why patients choose microscope-assisted treatment</h2>
  <p className="shell-body">Magnification reveals canals that a naked-eye procedure misses. That means cleaner shaping, fewer retreatment visits, and a tooth that lasts longer.</p>
</Reveal>

<StatCounter stats={[
  { value: 4200, suffix: '+', label: 'Root canals completed' },
  { value: 98, suffix: '%', label: 'Single-visit success' },
  { value: 19, suffix: ' yrs', label: 'Clinical experience' },
  { value: 4, suffix: '.9', label: 'Average patient rating' }
]} columns={4} />

<Parallax speed={0.2}>
  <QuickSummary title="What a single visit involves" points={[
    "3D scan and canal mapping before any drilling begins",
    "Magnification-guided cleaning of every canal branch",
    "Bioceramic sealing for a tighter, longer-lasting fill",
    "Same-day crown impression, no second appointment for fitting"
  ]} />
</Parallax>

<Marquee items={["Microscope-assisted", "Single-visit RCT", "3D imaging", "Bioceramic sealing", "Painless technique"]} />

<TiltCard intensity={9}>
  <section className="shell-section">
    <h3>Cost transparency, before you commit</h3>
    <CostComparisonTable rows={[
      { label: "Single-visit RCT", detail: "Including 3D scan and bioceramic seal", price: "Rs 6,500" },
      { label: "Multi-visit RCT", detail: "Two to three sittings", price: "Rs 8,200" },
      { label: "Retreatment", detail: "Where a previous root canal failed", price: "Rs 11,000" }
    ]} />
  </section>
</TiltCard>

<StickyScene height={1.4}>
  <section className="shell-section">
    <p className="shell-eyebrow">Pinned section</p>
    <h2>Our treatment protocol</h2>
    <p className="shell-body">This section stays pinned while the page scrolls, which is how award-winning sites pace a narrative moment.</p>
  </section>
</StickyScene>

<Reveal from="scale">
  <FaqAccordion items={[
    { q: "Is a root canal painful?", a: "With modern anaesthesia the procedure itself is comfortable; most patients report mild tenderness for a day or two afterwards." },
    { q: "How long does a single visit take?", a: "Plan on ninety minutes including scanning, shaping, sealing and the crown impression." },
    { q: "Will I need a crown?", a: "A back tooth usually needs one to protect the treated tooth. We take the impression in the same visit." }
  ]} />
</Reveal>

<Reveal from="bottom">
  <DoctorReviewedBadge name="Dr Anjali Deshpande" credentials="MDS, Conservative Dentistry" date="October 2026" />
</Reveal>
`;

/* --------------------------------------------------------------------- run */

const sites = await (
  await fetch(`${URL_}/rest/v1/sites?select=id,slug&slug=eq.${encodeURIComponent(slug)}`, { headers: H })
).json();
if (!Array.isArray(sites) || !sites.length) {
  console.error(`[FAIL] no site with slug "${slug}"`);
  process.exit(1);
}
const site = sites[0];
console.log(`site ${site.slug} (${site.id})`);

// Replace the homepage's single section with the motion fixture.
const sections = [{ anchor: 'content', mdx: HOME_MDX.trim() }];

const res = await fetch(`${URL_}/rest/v1/pages?site_id=eq.${site.id}&slug=eq.${encodeURIComponent('/')}`, {
  method: 'PATCH',
  headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ sections, compiled_css: '' }),
});
const out = await res.json();
if (!res.ok) {
  console.error(`[FAIL] HTTP ${res.status}: ${JSON.stringify(out).slice(0, 300)}`);
  process.exit(1);
}
console.log(`[OK] updated ${out.length} page row(s); mdx ${HOME_MDX.trim().length} chars`);
console.log('     compiled_css cleared so the renderer recomputes it on demand');