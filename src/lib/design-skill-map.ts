/**
 * Maps a design genome's SHELL onto one vendored design skill.
 *
 * WHY THIS AXIS EXISTS. The genome picks structure (shell, nav, colour mode,
 * rhythm, fonts) but the page agent was told only "asymmetric 4/8 columns
 * divided by 1px hairline rules" and left to invent the visual language. That is
 * why sites looked generically competent rather than designed: the brief
 * constrained the grid and nothing constrained the craft. The vendored registry
 * (67 skills, MIT, see design-skills/LICENSE) supplies opinionated per-style
 * rules - spacing rhythm, state coverage, anti-patterns, a QA checklist - which
 * is exactly the missing layer.
 *
 * WHY A MAP AND NOT A FREE CHOICE OVER 67. A skill that contradicts the shell
 * produces incoherent output: `brutalism` rules injected into `clinical-glass`
 * (translucent cards, backdrop blur, soft elevation) would fight the surface
 * treatment the shell components already render. So each shell gets a pool of
 * skills whose declared visual_style is compatible, and the picker chooses
 * inside that pool. The shell stays authoritative; the skill fills the gaps the
 * shell leaves open.
 *
 * WHY IT IS SAFE TO ADD. The skill is a SUB-AXIS of the shell, so it cannot
 * weaken the genome's guarantees - it can only make two same-shell tenants
 * differ further. Nothing here touches structureSignature(), the bans B1-B4, or
 * similarityTo(); genome.test.ts stays valid unchanged.
 *
 * DETERMINISM. Same seed + same shell => same skill, always. The genome is
 * reproducible per tenant and a re-run must not silently restyle a live site.
 */

import type { ShellArchetype } from './types';
import skillsData from './design-skills.json';

export interface DesignSkill {
  slug: string;
  name: string;
  description: string;
  visual_style: string[];
  typography_scale: string | null;
  weights: string | null;
  colour_roles: string | null;
  spacing_scale: string | null;
  substance: string;
}

interface SkillsFile {
  source: string;
  count: number;
  skills: DesignSkill[];
}

export const DESIGN_SKILLS: DesignSkill[] = (skillsData as SkillsFile).skills;

const BY_SLUG = new Map(DESIGN_SKILLS.map((s) => [s.slug, s]));

/**
 * Explicit preferred slugs per shell, then keyword scoring as the generaliser.
 *
 * The named lists encode judgement the keywords cannot: `premium` reads as
 * "Apple-inspired" which is closer to clinical-glass than the word list suggests,
 * and `paper` is a warm-organic surface metaphor rather than an editorial one.
 */
const PREFERRED: Record<ShellArchetype, string[]> = {
  'clinical-glass': [
    'glassmorphism', 'premium', 'refined', 'sleek', 'shadcn', 'material',
    'clean', 'modern', 'minimal', 'contemporary', 'corporate',
    // flat: "two-dimensional, clean typography, no 3D effects" is the same
    // restraint clinical-glass renders as translucent panels.
    'flat',
    // agentic: conversational, minimal controls, clear outcomes - a glass
    // surface, not a textured or modular one.
    'agentic',
  ],
  'editorial-magazine': [
    'editorial', 'storytelling', 'vintage', 'retro', 'paper', 'artistic',
    'expressive', 'dramatic', 'lingo', 'professional',
    // basic: print-inspired, book/magazine grids. The most literal editorial
    // skill in the registry; the slug undersells it.
    'basic',
    // creative / fantasy: character-driven and thematic with expressive
    // display type. Both read as a magazine spread, not a dashboard.
    'creative', 'fantasy',
  ],
  'swiss-brutalist': [
    'brutalism', 'neobrutalism', 'bold', 'geometric', 'square', 'mono',
    'structured', 'dithered', 'riso', 'matrix',
    // ant: data-dense enterprise grids - Swiss by lineage.
    'ant',
    // neon: declared only 'high-contrast', which is a brutalist property, and
    // it has no softer home (glass forbids high contrast, bento is modular).
    'neon',
  ],
  'warm-organic': [
    'cafe', 'terracotta', 'claymorphism', 'doodle', 'sketch', 'friendly',
    'soft', 'artistic', 'paper', 'vibrant',
    // fiction: children's-book illustration, warm cream, big display type.
    // skeumorphism: textured surfaces and physical metaphors - the organic
    // analogue, not a playful-modular one.
    'fiction', 'skeumorphism',
  ],
  'bento-modular': [
    'bento', 'levels', 'pulse', 'enterprise', 'data-dense', 'power',
    'colorful', 'playful', 'futuristic', 'gradient',
    // cosmic: dark, spatial, immersive - reads as luminous modules.
    // tetris: block-game geometry is literally modular cells.
    'cosmic', 'tetris',
  ],
};

/**
 * Keyword affinity between a skill's declared visual_style and a shell.
 *
 * Matched against the shell's own descriptors rather than its name, because the
 * names are not descriptive to a matcher ('warm-organic' does not contain
 * 'rounded'), while its surface_treatment does. Kept as a plain table so the
 * reasoning is auditable rather than embedded in a prompt.
 */
const SHELL_KEYWORDS: Record<ShellArchetype, string[]> = {
  // 'high-contrast' deliberately absent: it is declared by almost every skill in
  // the registry, including neobrutalism and dithered, so leaving it here scored
  // a brutalist surface as a glass match.
  'clinical-glass': ['glass', 'liquidglass', 'glassmorphism', 'clean', 'rounded', 'soft shadows', 'premium', 'minimal', 'modern'],
  'editorial-magazine': ['editorial', 'vintage', 'retro', 'artistic', 'expressive', 'dramatic', 'storytelling', 'big headings'],
  'swiss-brutalist': ['bold', 'high-contrast', 'brutal', 'thick-bordered', 'dotted borders', 'geometric', 'structured', 'mono', 'data-dense', 'matrix'],
  'warm-organic': ['friendly', 'playful', 'soft', 'rounded', 'warm', 'cafe', 'terracotta', 'doodle', 'sketch', 'paper'],
  'bento-modular': ['bento', 'cards', 'vibrant', 'colorful', 'modern', 'clean', 'enterprise', 'playful', 'gradient', 'futuristic'],
};

/** FNV-1a, matching genome.ts so a seed behaves identically on both axes. */
function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Scores one skill against one shell: preferred-list bonus + keyword hits.
 *
 * Exported so the affinity map can be inspected as a matrix. Judgement encoded
 * in PREFERRED/SHELL_KEYWORDS is only auditable if the resulting scores are
 * readable; a picker that collapses onto one skill is invisible from the
 * outside and obvious from the inside.
 */
export function scoreSkill(skill: DesignSkill, shell: ShellArchetype): number {
  const prefIdx = PREFERRED[shell].indexOf(skill.slug);
  let score = prefIdx === -1 ? 0 : 100 - prefIdx;

  const keywords = SHELL_KEYWORDS[shell];
  for (const declared of skill.visual_style) {
    const norm = declared.toLowerCase();
    for (const kw of keywords) {
      // Exact hits weigh double a substring hit. Substring matching is needed
      // ('liquidglass effect' must reach 'glass') but it is also how 'bold'
      // matched 'bolder' and one generic word dragged an unrelated style in, so
      // it is worth less and alone is not enough to qualify (see
      // KEYWORD_ELIGIBILITY_MIN).
      if (norm === kw) score += 6;
      else if (norm.includes(kw) || kw.includes(norm)) score += 3;
    }
  }
  return score;
}

/**
 * A skill scores on keywords but is not on the shell's preferred list still has
 * to clear this bar to be eligible. One stray hit must not qualify: that is how
 * `neobrutalism` reached clinical-glass (a single 'high-contrast' match).
 */
const KEYWORD_ELIGIBILITY_MIN = 9;

/**
 * How many of a shell's best skills a seed may be spread across.
 *
 * Argmax was the first collapse: `vintage` sat 4 points above `editorial`, so
 * every tenant on editorial-magazine got the same skill forever. Taking the top
 * BAND and hashing within it keeps the choice inside the coherent head of the
 * pool while giving real variety.
 */
const BAND = 6;

/**
 * Picks the design skill for a tenant.
 *
 * Ties are broken by a seed hash (same technique as genome.rankAxisValues) so
 * two tenants created in the same second do not collapse onto the same skill,
 * and so the head of PREFERRED is not permanently favoured.
 */
export function pickDesignSkill(
  shell: ShellArchetype,
  seed: string
): { skill: DesignSkill; candidates: string[] } {
  const eligible = DESIGN_SKILLS.map((skill) => ({
    skill,
    score: scoreSkill(skill, shell),
  }))
    // Curated membership always qualifies; a keyword-only match must clear the
    // bar. Zero-scoring skills are dropped outright - see the note on
    // KEYWORD_ELIGIBILITY_MIN for why hashing one into a shell is wrong.
    .filter(
      (entry) =>
        entry.score > 0 &&
        (PREFERRED[shell].includes(entry.skill.slug) ||
          entry.score >= KEYWORD_ELIGIBILITY_MIN)
    )
    // Slug as the tiebreak makes the ordering stable and independent of the
    // seed, so the band itself never shifts - only the pick within it does.
    .sort(
      (a, b) =>
        b.score - a.score || a.skill.slug.localeCompare(b.skill.slug)
    );

  if (!eligible.length) {
    throw new Error(`shell "${shell}" has no eligible design skills - check PREFERRED`);
  }

  const band = eligible.slice(0, Math.min(BAND, eligible.length));
  const pick = band[hashSeed(`band::${seed}::${shell}`) % band.length];

  return {
    skill: pick.skill,
    // The whole eligible pool, not just the band: this is what the reachability
    // test reads, and a skill the shell would never pick is still mapped to it.
    candidates: eligible.map((entry) => entry.skill.slug),
  };
}

/**
 * Renders the skill as a prompt block.
 *
 * Deliberately framed as a SUBORDINATE brief. Without the precedence clause the
 * agent treats the skill as the highest-numbered instruction and starts
 * satisfying its QA checklist instead of the shell's surface treatment.
 */
export function designSkillBlock(skill: DesignSkill): string {
  return [
    `VISUAL DESIGN LANGUAGE: ${skill.name} (${skill.slug})`,
    `Reference only: ${skill.description}`,
    '',
    'PRECEDENCE: the SHELL above is authoritative for structure, grid, surface',
    'treatment, colour and type. This skill governs only the craft details the',
    'shell leaves open - state coverage, spacing discipline, interaction',
    'quality, anti-patterns. Where they disagree, the shell wins.',
    '',
    'The skill\'s own tokens are NOT reproduced here on purpose: hex values and',
    'font names come from the genome, and you must never write either.',
    '',
    skill.substance,
  ].join('\n');
}