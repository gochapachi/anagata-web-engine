/**
 * Extracts the usable substance of each vendored design skill into one JSON file.
 *
 * WHY AN EXTRACTOR AND NOT RAW INJECTION. Measured across the 67 vendored skills:
 * the average SKILL.md is 3,719 bytes, but the tail (from `## Expected Behavior`
 * onward) is BYTE-IDENTICAL between skills - glassmorphism, professional, editorial
 * and premium all hash to the same 201b2c85c7c1. That tail is instructions for
 * someone WRITING a design-system document, not for someone building a page. The
 * `## Mission` section is actively harmful: it says "You are an expert
 * design-system guideline author... Create practical, implementation-ready
 * guidance", which would push the page agent toward producing a design doc instead
 * of MDX.
 *
 * So this keeps only the sections that describe the design itself - Brand, Style
 * Foundations, Accessibility, Writing Tone, Rules: Do, Rules: Don't - which is
 * 993-1,406 bytes per skill (~250-350 tokens), and drops the rest.
 *
 * TWO DELIBERATE OMISSIONS, both because the genome owns the axis and the design
 * skill must not fight it:
 *   - Colour tokens. Every skill hardcodes a palette (#FECE14 for professional,
 *     #1856FF for glassmorphism). The genome's colour_mode + brand hue is
 *     load-bearing for anti-sameness ban B3 (shell,colour) and for a client's real
 *     brand, so only the palette's STRUCTURE (which semantic roles exist) is kept.
 *   - Font names. Ban B4 requires the heading font to be new within PAIR_WINDOW;
 *     letting a skill pick fonts would silently break that guarantee. The
 *     typography SCALE and weight range are kept, since those do not collide.
 *
 * Usage: node n8n/scripts/vendor-design-skills.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const skillsDir = path.join(repoRoot, 'design-skills');
const outFile = path.join(repoRoot, 'src', 'lib', 'design-skills.json');

/** Sections that describe the design, in the order the agent should read them. */
const KEEP = [
  'Brand',
  'Style Foundations',
  'Accessibility',
  'Writing Tone',
  'Rules: Do',
  "Rules: Don't",
];

function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/** Splits a markdown body into `## Heading` -> text blocks. */
function splitSections(body) {
  const cleaned = body
    .replace(/<!--\s*TYPEUI_SH_MANAGED_(START|END)\s*-->/g, '')
    .replace(/^#\s+.*$/m, '');
  const out = {};
  let current = null;
  for (const line of cleaned.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1];
      out[current] = [];
      continue;
    }
    // ### subheadings belong to their parent ## section.
    if (current) out[current].push(line);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim();
  return out;
}

/** Pulls the visual-style keywords out of the Style Foundations bullet list. */
function visualStyle(text) {
  const m = /Visual style:\s*(.+)/i.exec(text);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Typography scale only, without the font NAMES (genome owns fonts - see header). */
function typographyScale(text) {
  const m = /Typography scale:\s*([^|\n]+)/i.exec(text);
  return m ? m[1].trim() : null;
}

/** Weight range, kept because it does not collide with the font axis. */
function weights(text) {
  const m = /weights=([^\n|]+)/i.exec(text);
  return m ? m[1].trim() : null;
}

/** Colour ROLE NAMES only - the palette structure, never the hex values. */
function colourRoles(text) {
  const m = /Color palette:\s*([^|\n]+)/i.exec(text);
  return m ? m[1].trim() : null;
}

function spacingScale(text) {
  const m = /Spacing scale:\s*(.+)/i.exec(text);
  return m ? m[1].trim() : null;
}

if (!existsSync(skillsDir)) {
  console.error(`[FAIL] ${skillsDir} not found - vendor the registry first`);
  process.exit(1);
}

const slugs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(skillsDir, d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort();

const skills = [];
const problems = [];

for (const slug of slugs) {
  const raw = readFileSync(path.join(skillsDir, slug, 'SKILL.md'), 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const sections = splitSections(body);

  const missing = KEEP.filter((s) => !sections[s]);
  if (missing.length) problems.push(`${slug}: missing ${missing.join(', ')}`);

  const foundations = sections['Style Foundations'] ?? '';
  const kept = KEEP.filter((s) => sections[s]).map((s) => `## ${s}\n${sanitize(sections[s])}`);
  const substance = kept.join('\n\n');

  skills.push({
    slug,
    name: meta.name ?? slug,
    description: meta.description ?? '',
    visual_style: visualStyle(foundations),
    typography_scale: typographyScale(foundations),
    weights: weights(foundations),
    colour_roles: colourRoles(foundations),
    spacing_scale: spacingScale(foundations),
    substance,
  });
}

/**
 * Redacts the parts of a skill that would COLLIDE with the genome.
 *
 * The genome owns typography and colour: the agent prompt's HARD RULE 3 says
 * "NEVER write hex codes, rgb(), or font names", and the tenant's CSS variables
 * are set from the genome, not from the skill. But the vendored SKILL.md text
 * carries both inline:
 *
 *   - Typography scale: ... | Fonts: primary=Plus Jakarta Sans, ... | weights=...
 *   - Color palette: ...    | Tokens: primary=#1856FF, secondary=#3A344E, ...
 *
 * Injecting that verbatim hands the agent a brand hex and a font name and tells
 * it to honour the skill, so it starts overriding the genome and two tenants
 * built from the same shell converge on Plus Jakarta Sans - the exact sameness
 * this whole system exists to prevent. The structural facts survive (scale,
 * weight range, which colour ROLES exist); only the concrete values go.
 */
function sanitize(text) {
  return text
    .replace(/\|\s*Fonts:[^|\n]*/gi, '')
    .replace(/\|\s*Tokens:[^|\n]*/gi, '')
    .replace(/Tokens:[^|\n]*/gi, '')
    .replace(/#[0-9a-fA-F]{3,8}\b/g, '')
    .replace(/\s{2,}(\|)/g, ' $1')
    .replace(/\|\s*(?=\n|$)/g, '')
    .trim();
}

const sizes = skills.map((s) => Buffer.byteLength(s.substance, 'utf8')).sort((a, b) => a - b);
const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);

writeFileSync(
  outFile,
  JSON.stringify(
    {
      source: 'https://github.com/bergside/awesome-design-skills (MIT)',
      extracted_by: 'n8n/scripts/vendor-design-skills.mjs',
      note: 'Colour values and font names are intentionally omitted - the design genome owns those axes. See the extractor header.',
      count: skills.length,
      skills,
    },
    null,
    2
  ) + '\n'
);

console.log(`=== vendored ${skills.length} skills -> src/lib/design-skills.json`);
console.log(`    substance per skill: min ${sizes[0]}  avg ${avg}  max ${sizes[sizes.length - 1]} bytes`);
console.log(`    (~${Math.round(avg / 4)} tokens injected per site)`);
console.log(`    raw SKILL.md average was 3,719 bytes -> ${(100 - (avg / 3719) * 100).toFixed(0)}% smaller`);
console.log('');
console.log('=== visual_style vocabulary (drives the shell affinity map) ===');
const vocab = {};
for (const s of skills) for (const v of s.visual_style) vocab[v] = (vocab[v] ?? 0) + 1;
console.log(
  Object.entries(vocab)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}(${n})`)
    .join('  ')
);
console.log('');
console.log('=== skills with NO visual_style line (need an explicit home in the map) ===');
const homeless = skills.filter((s) => s.visual_style.length === 0).map((s) => s.slug);
console.log(homeless.length ? '  ' + homeless.join('  ') : '  (none)');
if (problems.length) {
  console.log('');
  console.log('[WARN] section gaps:');
  for (const p of problems.slice(0, 10)) console.log('  ' + p);
}
console.log('');
console.log(`[OK] wrote ${path.relative(repoRoot, outFile)}`);