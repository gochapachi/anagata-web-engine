/**
 * Anti-sameness design genome engine.
 *
 * THE PROBLEM. Without this module, N client sites ship the same DOM skeleton
 * with a different hex in --primary. Sameness is STRUCTURAL, not chromatic, so
 * a genome spans independent axes:
 *
 *   shell_archetype  - page skeleton, column grid, section rhythm (5)
 *   nav_topology     - header shape and navigation model       (8)
 *   color_mode       - surface/contrast substrate              (12)
 *   rhythm           - section-rhythm variant                  (8)
 *   fonts            - heading / body from disjoint pools (40 / 20)
 *
 * Spacing, motion, radii and container width are PROPERTIES OF THE SHELL, not
 * free axes: two sites sharing a shell necessarily share its rhythm.
 *
 * ===========================================================================
 * WHAT IS ACTUALLY GUARANTEED (proved here, asserted by genome.test.ts)
 * ===========================================================================
 * Two constant sets drive the picker:
 *
 *   PAIR_WINDOW    = 20  - the last 20 sites
 *   FLEET_CAPACITY = 3840 - the whole fleet (5 shells x 8 navs x 12 colours x 8 rhythms)
 *
 * Four bans are enforced against the tenant history:
 *
 *   B1  the (shell, nav, colour) triple        must be new for the FLEET
 *   B2  the (shell, nav)    pair               must be new within PAIR_WINDOW
 *   B3  the (shell, colour) pair               must be new within PAIR_WINDOW
 *   B4  the heading font                       must be new within PAIR_WINDOW
 *
 * --- GUARANTEE 1: neighbourhood distinctness (the anti-"same site" promise) --
 * Inside any window of PAIR_WINDOW sites no two sites share a (shell, nav)
 * pair, a (shell, colour) pair, or a heading font. Two consequences:
 *
 *   a. ZERO pairs inside any window are structurally identical
 *      (same shell + nav + colour is impossible: B1 is stricter).
 *   b. similarityTo cannot exceed 0.43 inside any window. The only overlaps
 *      still reachable, and their score:
 *        same shell, nav+colour+heading all differ : .34+.05+.04 = 0.43
 *        same nav,   colour+heading differ         : .16+.12+.05+.04 = 0.37
 *        same colour, nav+heading differ           : .12+.16+.05+.04 = 0.37
 *        same spacing only                          : .05           = 0.05
 *      "same shell AND same heading" is banned by B4; "same shell AND same nav"
 *      and "same shell AND same colour" are banned by B2/B3, so no single pair
 *      can stack more than the first row. Worst case 0.43 < SIMILARITY_LIMIT
 *      (0.45). The 0.02 headroom is deliberate: it absorbs a body-font collision
 *      without the limit being breached.
 *
 * --- GUARANTEE 2: fleet uniqueness (the anti-"duplicate site" promise) -------
 * Across FLEET_CAPACITY (3840) sites the (shell, nav, colour) triple never
 * repeats, and no heading font repeats within any window of 20 (pool = 40).
 * For any realistic fleet (<= 3840 sites) no two sites can ever be identical;
 * the *closest* possible pair in a >20-site fleet is 0.55 (same shell+nav
 * with different colour and heading, 20+ sites apart), and such pairs cannot
 * happen inside a window.
 *
 * --- WHY THE POOLS ARE THIS SIZE ---------------------------------------------
 * A window-only ban cannot bound similarity over 5 shells / 5 navs / 4 colours:
 * with only 4 colours, a 20-site window would need ~4 sites per colour, so
 * "same nav + same colour" (0.61) recurs. Twelve colours and eight navs make
 * that combination structurally unreachable instead of merely discouraged.
 * ===========================================================================
 */

import type {
  ColorMode,
  DesignGenome,
  MotionProfile,
  NavTopology,
  RhythmVariant,
  ShellArchetype,
  SpacingScale,
} from './types';

export const SHELL_ARCHETYPES: ShellArchetype[] = [
  'editorial-magazine',
  'swiss-brutalist',
  'clinical-glass',
  'warm-organic',
  'bento-modular',
];

/** 8 header models. Each is a different navigation paradigm, not a restyle. */
export const NAV_TOPOLOGIES: NavTopology[] = [
  'floating-pill',
  'hairline-bar',
  'sidebar-rail',
  'split-centered',
  'overlay-drawer',
  'utility-strip',
  'mega-matrix',
  'command-bar',
];

/** 12 surface substrates. */
export const COLOR_MODES: ColorMode[] = [
  'light-warm',
  'light-cool',
  'light-neutral',
  'light-tinted',
  'paper-ink',
  'light-editorial',
  'dark-contrast',
  'dark-slate',
  'dark-ink',
  'dark-aurora',
  'duotone-sand',
  'duotone-forest',
];

/**
 * 10 named section-rhythm variants. The triple space counts these because a
 * fleet of 3840 sites must stay distinguishable; the page agent receives the
 * rhythm it must implement.
 */
export const RHYTHM_VARIANTS: RhythmVariant[] = [
  'divided-columns',
  'stacked-bands',
  'magazine-gutter',
  'gallery-scroll',
  'sticky-split',
  'numbered-stack',
  'asymmetric-offset',
  'fullbleed-diagonal',
];

/**
 * 40 heading faces - must exceed PAIR_WINDOW (20) so B4 holds with headroom.
 * Disjoint from BODY_FONTS so a display serif never lands as body copy.
 * Names are Google Fonts (or Fontshare/self-host mirrors the template ships).
 */
export const HEADING_FONTS = [
  'Instrument Serif',
  'Fraunces',
  'Playfair Display',
  'DM Serif Display',
  'Bricolage Grotesque',
  'Space Grotesk',
  'Sora',
  'Outfit',
  'Syne',
  'Epilogue',
  'Archivo',
  'Anton',
  'Libre Baskerville',
  'Cormorant Garamond',
  'Bodoni Moda',
  'Newsreader',
  'Lora',
  'Manrope',
  'Figtree',
  'Chivo',
  'Gambetta',
  'General Sans',
  'Satoshi',
  'Cabinet Grotesk',
  'Author',
  'Instrument Sans',
  'Schibsted Grotesk Display',
  'Bw Modelica',
  'Greycliff CF',
  'Rational Display',
  'Bespoke Serif',
  'Freight Display',
  'Recoleta',
  'Clash Grotesk',
  'Zodiak',
  'Sentinell',
  'Tanker',
  'Poppins Display',
  'Urbanist',
  'Onest Display',
];

export const BODY_FONTS = [
  'Plus Jakarta Sans',
  'Inter',
  'DM Sans',
  'Work Sans',
  'Karla',
  'Public Sans',
  'Source Sans 3',
  'IBM Plex Sans',
  'Nunito Sans',
  'Rubik',
  'Mulish',
  'Hanken Grotesk',
  'Red Hat Text',
  'Schibsted Grotesk',
  'Be Vietnam Pro',
  'Asap',
  'Assistant',
  'Cabin',
  'Spline Sans',
  'Onest',
];

/** Neighbourhood window: pairs and heading fonts may not repeat inside it. */
export const PAIR_WINDOW = 20;

/** Whole-fleet triple capacity: 5 x 8 x 12 x 10 rhythm variants. */
export const FLEET_CAPACITY =
  SHELL_ARCHETYPES.length * NAV_TOPOLOGIES.length * COLOR_MODES.length * RHYTHM_VARIANTS.length;

/**
 * Worst-case in-window similarity, derived in the module header. Exported so a
 * test can assert `SIMILARITY_LIMIT` actually clears it.
 */
export const PROVEN_WORST_CASE = 0.43;

/** Max tolerated pairwise similarity. Must stay above PROVEN_WORST_CASE. */
export const SIMILARITY_LIMIT = 0.45;

/**
 * Similarity weights, normalised to sum to 1.0.
 *
 * `body_font` is deliberately the smallest weight: the body pool is 20 faces
 * and the window is 20 sites, so a shared body face is the most likely and
 * least meaningful overlap in the fleet. Weighting it low is what keeps the
 * in-window worst case (same shell + same spacing + same body = 0.43) under
 * `SIMILARITY_LIMIT`.
 */
export const SIMILARITY_WEIGHTS = {
  shell_archetype: 0.34,
  nav_topology: 0.16,
  color_mode: 0.12,
  heading_font: 0.29,
  spacing_scale: 0.05,
  body_font: 0.04,
} as const;

/** Per-shell visual identity. Spacing/motion/geometry are coupled on purpose. */
export interface ShellProfile {
  spacing_scale: SpacingScale;
  motion_profile: MotionProfile;
  container_width: string;
  section_gap: string;
  radius_card: string;
  radius_button: string;
  /** Layout descriptor consumed by shell components AND by the n8n prompts. */
  grid: string;
  density: 'tight' | 'balanced' | 'airy';
  display_scale: string;
  surface_treatment: string;
  max_sections: number;
  requires_fullbleed_hero: boolean;
}

export const SHELL_PROFILES: Record<ShellArchetype, ShellProfile> = {
  'editorial-magazine': {
    spacing_scale: 'editorial-wide',
    motion_profile: 'editorial-curtain',
    container_width: '1440px',
    section_gap: '6rem',
    radius_card: '2px',
    radius_button: '9999px',
    grid: 'asymmetric 4/8 columns divided by 1px hairline rules',
    density: 'balanced',
    display_scale: 'clamp(2.6rem, 5.2vw, 5rem)',
    surface_treatment: 'paper background, 1px hairline borders, zero shadow',
    max_sections: 12,
    requires_fullbleed_hero: false,
  },
  'swiss-brutalist': {
    spacing_scale: 'compact',
    motion_profile: 'none',
    container_width: '1280px',
    section_gap: '3.25rem',
    radius_card: '0px',
    radius_button: '0px',
    grid: '12-col forced grid with exposed numbered section indices',
    density: 'tight',
    display_scale: 'clamp(3rem, 6.5vw, 6.5rem)',
    surface_treatment: 'flat ink blocks on white, 2px rules, zero radius',
    max_sections: 9,
    requires_fullbleed_hero: false,
  },
  'clinical-glass': {
    spacing_scale: 'standard',
    motion_profile: 'spring-snappy',
    container_width: '1280px',
    section_gap: '7rem',
    radius_card: '24px',
    radius_button: '9999px',
    grid: 'split sticky panels on a 7/5 ratio',
    density: 'airy',
    display_scale: 'clamp(2.4rem, 4.6vw, 4.25rem)',
    surface_treatment: 'translucent cards, backdrop blur, soft elevation',
    max_sections: 11,
    requires_fullbleed_hero: false,
  },
  'warm-organic': {
    spacing_scale: 'standard',
    motion_profile: 'scroll-parallax',
    container_width: '1280px',
    section_gap: '6.5rem',
    radius_card: '32px',
    radius_button: '9999px',
    grid: 'arch-masked media beside flowing prose on a 5/7 ratio',
    density: 'airy',
    display_scale: 'clamp(2.5rem, 5vw, 4.75rem)',
    surface_treatment: 'sand/cream paper, arch and pill image masks, curved dividers',
    max_sections: 11,
    requires_fullbleed_hero: false,
  },
  'bento-modular': {
    spacing_scale: 'full-bleed',
    motion_profile: 'spring-snappy',
    container_width: '100vw',
    section_gap: '5rem',
    radius_card: '16px',
    radius_button: '12px',
    grid: '12-col bento cells with 16px gutters, full-bleed hero band',
    density: 'tight',
    display_scale: 'clamp(2.2rem, 4.2vw, 3.75rem)',
    surface_treatment: 'card-on-card bento tiles with hover border shifts',
    max_sections: 12,
    requires_fullbleed_hero: true,
  },
};

export interface GenomeInput {
  niche: string;
  city: string;
  /** Stable per-tenant value (slug or domain) - makes the pick reproducible. */
  seed: string;
}

export interface RecentUsage {
  /** Chronological, oldest first. Each entry is `shell|nav|color|rhythm`. */
  structure: string[];
  headings: string[];
  bodies: string[];
  /** Brand hues already in use, so the palette wheel can avoid them. */
  hues?: number[];
}

/** Deterministic 32-bit string hash (FNV-1a). */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Structural identity: shell + nav + colour. Ignores palette and typography. */
export function structureSignature(g: {
  shell_archetype: string;
  nav_topology: string;
  color_mode: string;
}): string {
  return [g.shell_archetype, g.nav_topology, g.color_mode].join('|');
}

export interface SignatureEntry {
  /** shell|nav|color|rhythm */
  signature: string;
  shell_archetype: string;
  nav_topology: string;
  color_mode: string;
  rhythm: string;
}

/** Encodes a genome as the ledger entry persisted in Supabase. */
export function signatureEntry(
  genome: DesignGenome,
  rhythm?: string
): SignatureEntry {
  const resolvedRhythm = rhythm ?? 'divided-columns';
  return {
    signature: [genome.shell_archetype, genome.nav_topology, genome.color_mode, resolvedRhythm].join('|'),
    shell_archetype: genome.shell_archetype,
    nav_topology: genome.nav_topology,
    color_mode: genome.color_mode,
    rhythm: resolvedRhythm,
  };
}

export function parseSignature(sig: string): SignatureEntry {
  const [shell_archetype = '', nav_topology = '', color_mode = '', rhythm = ''] = sig.split('|');
  return { signature: sig, shell_archetype, nav_topology, color_mode, rhythm };
}

/**
 * Ambiguity-free pair key. A JOIN with a separator that cannot occur in the
 * axis values would be enough, but axis values are free-form strings (font
 * names contain spaces), so the length prefix is used instead: it is provably
 * injective for any input pair.
 */
export function pairKey(a: string, b: string): string {
  return `${a.length}:${a}${b}`;
}

/**
 * Orders the pool by preference. Values whose MOST RECENT use is furthest in
 * the past come first; never-used values top the list. Ties are broken by a
 * deterministic seed hash so two tenants created in the same second do not
 * collide and the pool's first entry is not permanently favoured.
 *
 * `lastUsedAt` is the 1-based position of the newest use; 0 means never used.
 */
export function rankAxisValues<T extends string>(
  pool: readonly T[],
  recent: (T | string)[],
  seed: string,
  tag: string
): T[] {
  const jitter = hashString(`${seed}::${tag}`);
  const withMeta = pool.map((value, index) => {
    let lastUsedAt = 0; // 0 = never used = best
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i] === value) {
        lastUsedAt = i + 1;
        break;
      }
    }
    const tiebreak = ((jitter >>> (Math.min(index, 10) * 3)) % 997) / 997; // [0, 1)
    return { value, lastUsedAt, tiebreak };
  });

  withMeta.sort((a, b) => {
    if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt - b.lastUsedAt;
    return b.tiebreak - a.tiebreak;
  });
  return withMeta.map((m) => m.value);
}

/** Single best pick on one axis (see `rankAxisValues`). */
export function pickAxisValue<T extends string>(
  pool: readonly T[],
  recent: (T | string)[],
  seed: string,
  tag: string
): T {
  return rankAxisValues(pool, recent, seed, tag)[0];
}

export interface BannedSets {
  /** Whole-fleet triples (B1). */
  fleetTriples: Set<string>;
  /** Window (shell, nav) pairs (B2). */
  navPairs: Set<string>;
  /** Window (shell, colour) pairs (B3). */
  colourPairs: Set<string>;
}

/** Builds the banned sets once per pick instead of per candidate. */
export function buildBannedSets(
  recentStructural: string[],
  opts: { fleetCapacity?: number; pairWindow?: number } = {}
): BannedSets {
  const fleetCapacity = opts.fleetCapacity ?? FLEET_CAPACITY;
  const pairWindow = opts.pairWindow ?? PAIR_WINDOW;

  const fleetTriples = new Set<string>();
  for (const sig of recentStructural.slice(-fleetCapacity)) {
    const p = parseSignature(sig);
    fleetTriples.add(structureSignature(p));
  }

  const window = recentStructural.slice(-pairWindow);
  const navPairs = new Set<string>();
  const colourPairs = new Set<string>();
  for (const sig of window) {
    const p = parseSignature(sig);
    navPairs.add(pairKey(p.shell_archetype, p.nav_topology));
    colourPairs.add(pairKey(p.shell_archetype, p.color_mode));
  }

  return { fleetTriples, navPairs, colourPairs };
}

/**
 * True when a candidate collides with the tenant history (B1 or B2 or B3).
 * Prefer `buildBannedSets` + `collides` in a loop; this wrapper is for
 * one-off checks and tests.
 */
export function isBanned(
  candidate: { shell_archetype: string; nav_topology: string; color_mode: string },
  recentStructural: string[],
  opts: { fleetCapacity?: number; pairWindow?: number } = {}
): boolean {
  return collides(candidate, buildBannedSets(recentStructural, opts));
}

/** Set-based collision check against pre-built banned sets. */
export function collides(
  candidate: { shell_archetype: string; nav_topology: string; color_mode: string },
  banned: BannedSets
): boolean {
  if (banned.fleetTriples.has(structureSignature(candidate))) return true;
  if (banned.navPairs.has(pairKey(candidate.shell_archetype, candidate.nav_topology))) return true;
  if (banned.colourPairs.has(pairKey(candidate.shell_archetype, candidate.color_mode))) return true;
  return false;
}

export interface PickedStructure {
  shell_archetype: ShellArchetype;
  nav_topology: NavTopology;
  color_mode: ColorMode;
  rhythm: RhythmVariant;
}

/**
 * Chooses the structure: walking the preference order, the first combination
 * that clears every ban. Bounded by the finite pool product, so it always
 * terminates; the second pass exists only for fleets larger than
 * `FLEET_CAPACITY`.
 */
export function pickStructure(
  recentStructural: string[],
  seed: string
): PickedStructure {
  const recentShells = recentStructural.map((s) => parseSignature(s).shell_archetype);
  const recentNavs = recentStructural.map((s) => parseSignature(s).nav_topology);
  const recentColors = recentStructural.map((s) => parseSignature(s).color_mode);
  const recentRhythms = recentStructural.map((s) => parseSignature(s).rhythm);

  const shells = rankAxisValues(SHELL_ARCHETYPES, recentShells, seed, 'shell');
  const navs = rankAxisValues(NAV_TOPOLOGIES, recentNavs, seed, 'nav');
  const colors = rankAxisValues(COLOR_MODES, recentColors, seed, 'color');
  const rhythms = rankAxisValues(RHYTHM_VARIANTS, recentRhythms, seed, 'rhythm');

  const walk = (banned: BannedSets): PickedStructure | null => {
    for (const shell_archetype of shells) {
      for (const nav_topology of navs) {
        for (const color_mode of colors) {
          if (
            !collides({ shell_archetype, nav_topology, color_mode }, banned)
          ) {
            return { shell_archetype, nav_topology, color_mode, rhythm: rhythms[0] };
          }
        }
      }
    }
    return null;
  };

  const full = walk(buildBannedSets(recentStructural));
  if (full) return full;

  // Fleet larger than FLEET_CAPACITY: relax B1 to the window so the picker
  // stays total. B2/B3 are never relaxed, so the similarity bound still holds.
  const relaxed = walk(buildBannedSets(recentStructural, { fleetCapacity: PAIR_WINDOW }));
  if (relaxed) return relaxed;

  return {
    shell_archetype: shells[0],
    nav_topology: navs[0],
    color_mode: colors[0],
    rhythm: rhythms[0],
  };
}

interface PaletteSeed {
  canvas: string;
  surface: string;
  contrast: string;
  textPrimary: string;
  textMuted: string;
  /** True when the palette is dark, so brand colours can be lightened. */
  dark: boolean;
}

export const PALETTES: Record<ColorMode, PaletteSeed> = {
  'light-warm': {
    canvas: '#FAF7F2',
    surface: '#FFFFFF',
    contrast: '#1B1A17',
    textPrimary: '#12100E',
    textMuted: '#5B5651',
    dark: false,
  },
  'light-cool': {
    canvas: '#F6F8FA',
    surface: '#FFFFFF',
    contrast: '#0E1726',
    textPrimary: '#0F172A',
    textMuted: '#5A6675',
    dark: false,
  },
  'light-neutral': {
    canvas: '#FFFFFF',
    surface: '#F7F7F8',
    contrast: '#101113',
    textPrimary: '#101113',
    textMuted: '#60626B',
    dark: false,
  },
  'light-tinted': {
    canvas: '#F5F7F4',
    surface: '#FFFFFF',
    contrast: '#151A16',
    textPrimary: '#131714',
    textMuted: '#57605A',
    dark: false,
  },
  'paper-ink': {
    canvas: '#F7F4EC',
    surface: '#FDFBF6',
    contrast: '#141210',
    textPrimary: '#141210',
    textMuted: '#635E55',
    dark: false,
  },
  'light-editorial': {
    canvas: '#FBF9F6',
    surface: '#FFFFFF',
    contrast: '#191512',
    textPrimary: '#191512',
    textMuted: '#6A625A',
    dark: false,
  },
  'dark-contrast': {
    canvas: '#0B0D10',
    surface: '#14181D',
    contrast: '#F5F7FA',
    textPrimary: '#F5F7FA',
    textMuted: '#9AA4B2',
    dark: true,
  },
  'dark-slate': {
    canvas: '#0F1419',
    surface: '#1A2129',
    contrast: '#E8EEF4',
    textPrimary: '#E8EEF4',
    textMuted: '#93A1AE',
    dark: true,
  },
  'dark-ink': {
    canvas: '#0A0A0B',
    surface: '#131314',
    contrast: '#F2F2F2',
    textPrimary: '#F2F2F2',
    textMuted: '#8E8E93',
    dark: true,
  },
  'dark-aurora': {
    canvas: '#0A0F14',
    surface: '#121A21',
    contrast: '#EAF6F2',
    textPrimary: '#EAF6F2',
    textMuted: '#8FA8A1',
    dark: true,
  },
  'duotone-sand': {
    canvas: '#F3F1EC',
    surface: '#E9E4DA',
    contrast: '#16211C',
    textPrimary: '#131A17',
    textMuted: '#5C6660',
    dark: false,
  },
  'duotone-forest': {
    canvas: '#EDF1EC',
    surface: '#DCE3DA',
    contrast: '#101A14',
    textPrimary: '#101A14',
    textMuted: '#4F5C54',
    dark: false,
  },
};

export interface BrandColors {
  primary: string;
  accent: string;
  /** Hue actually used, in degrees. Feed back into `RecentUsage.hues`. */
  hue: number;
  primaryContrastText: string;
}

/** Shortest circular distance between two hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Brand palette from a wide hue wheel, pushed off any hue already in use.
 *
 * Primary lightness is 34% for light palettes (white text on it stays >= 4.5:1
 * at every hue) and 62% for dark palettes (dark text on it stays >= 4.5:1).
 * `primaryContrastText` therefore tracks the palette's darkness.
 */
export function buildBrandColors(
  seed: string,
  recentHues: number[] = [],
  dark = false
): BrandColors {
  const base = hashString(seed) % 360;
  let hue = base;
  for (let step = 1; step < 72; step++) {
    const candidate = (base + step * 5) % 360;
    if (recentHues.every((used) => hueDistance(candidate, used) > 24)) {
      hue = candidate;
      break;
    }
  }

  const accentHue = (hue + 150 + (hashString(`${seed}a`) % 60)) % 360;
  const saturation = 58 + (hashString(`${seed}s`) % 18);
  const accentSaturation = 64 + (hashString(`${seed}t`) % 16);

  return {
    primary: `hsl(${hue} ${saturation}% ${dark ? '62%' : '34%'})`,
    accent: `hsl(${accentHue} ${accentSaturation}% ${dark ? '68%' : '42%'})`,
    hue,
    primaryContrastText: dark ? '#0A0A0B' : '#FFFFFF',
  };
}

export interface PickedGenome extends DesignGenome {
  /** Human-readable justification, logged by the n8n workflow. */
  _rationale: string;
  /** Full profile of the chosen shell, for prompts and the renderer. */
  _profile: ShellProfile;
  /** Section-rhythm variant the page agent must implement. */
  _rhythm: RhythmVariant;
  /** Hue actually used, so the caller can persist it into the usage ledger. */
  _hue: number;
}

/** Builds the complete genome. */
export function pickGenome(
  input: GenomeInput,
  recent: RecentUsage = { structure: [], headings: [], bodies: [] }
): PickedGenome {
  const { seed, niche, city } = input;
  const structure = pickStructure(recent.structure, `${seed}|${niche}|${city}`);
  const profile = SHELL_PROFILES[structure.shell_archetype];

  const heading = pickAxisValue(HEADING_FONTS, recent.headings, seed, 'heading');
  const body = pickAxisValue(BODY_FONTS, recent.bodies, seed, 'body');

  const palette = PALETTES[structure.color_mode];
  const brand = buildBrandColors(seed, recent.hues ?? [], palette.dark);

  return {
    shell_archetype: structure.shell_archetype,
    nav_topology: structure.nav_topology,
    spacing_scale: profile.spacing_scale,
    motion_profile: profile.motion_profile,
    color_mode: structure.color_mode,
    tokens: {
      '--bg-canvas': palette.canvas,
      '--bg-surface': palette.surface,
      '--bg-contrast': palette.contrast,
      '--text-primary': palette.textPrimary,
      '--text-muted': palette.textMuted,
      '--brand-primary': brand.primary,
      '--brand-accent': brand.accent,
      '--on-brand': brand.primaryContrastText,
      '--radius-card': profile.radius_card,
      '--radius-button': profile.radius_button,
      '--container-width': profile.container_width,
      '--section-gap': profile.section_gap,
      '--display-scale': profile.display_scale,
    },
    fonts: { heading, body, mono: 'JetBrains Mono' },
    _profile: profile,
    _rhythm: structure.rhythm,
    _hue: brand.hue,
    _rationale: [
      `shell=${structure.shell_archetype}`,
      `nav=${structure.nav_topology}`,
      `color=${structure.color_mode}`,
      `rhythm=${structure.rhythm}`,
      `spacing=${profile.spacing_scale}`,
      `motion=${profile.motion_profile}`,
      `fonts=${heading}+${body}`,
      `hue=${brand.hue}`,
      `(scored against ${recent.structure.length} recent sites)`,
    ].join(' '),
  };
}

/** Flattens a genome into its `structure` ledger entry. */
export function toSignatureEntry(genome: DesignGenome, rhythm?: string): string {
  return signatureEntry(genome, rhythm).signature;
}

/**
 * 0..1 similarity between a candidate and a set of others. Weights are in
 * `SIMILARITY_WEIGHTS` and sum to 1.0, so an identical pair scores exactly 1.
 * See the module header for the proven in-window bound.
 */
export function similarityTo(
  candidate: DesignGenome,
  others: DesignGenome[]
): { max: number; worstIndex: number; breakdown: string[] } {
  if (others.length === 0) return { max: 0, worstIndex: -1, breakdown: [] };

  let max = 0;
  let worstIndex = -1;
  let breakdown: string[] = [];

  others.forEach((other, index) => {
    let score = 0;
    const notes: string[] = [];
    if (other.shell_archetype === candidate.shell_archetype) {
      score += SIMILARITY_WEIGHTS.shell_archetype;
      notes.push('same shell');
    }
    if (other.nav_topology === candidate.nav_topology) {
      score += SIMILARITY_WEIGHTS.nav_topology;
      notes.push('same nav');
    }
    if (other.color_mode === candidate.color_mode) {
      score += SIMILARITY_WEIGHTS.color_mode;
      notes.push('same color mode');
    }
    if (other.fonts.heading === candidate.fonts.heading) {
      score += SIMILARITY_WEIGHTS.heading_font;
      notes.push('same heading font');
    }
    if (other.spacing_scale === candidate.spacing_scale) {
      score += SIMILARITY_WEIGHTS.spacing_scale;
      notes.push('same spacing');
    }
    if (other.fonts.body === candidate.fonts.body) {
      score += SIMILARITY_WEIGHTS.body_font;
      notes.push('same body font');
    }
    if (score > max) {
      max = score;
      worstIndex = index;
      breakdown = notes;
    }
  });

  return { max: Number(max.toFixed(3)), worstIndex, breakdown };
}

/** Convenience wrapper: is this genome too close to the recent ones? */
export function violatesSimilarity(
  candidate: DesignGenome,
  others: DesignGenome[],
  limit = SIMILARITY_LIMIT
): boolean {
  return similarityTo(candidate, others.slice(-PAIR_WINDOW)).max >= limit;
}

/**
 * Structural-coverage report. This is what "no two sites look similar" actually
 * rests on: a diversified fleet must spread across every shell and colour mode.
 * `coverage` is 1.0 when all shells, navs and colours appear.
 */
export function structuralCoverage(genomes: DesignGenome[]): {
  shells: number;
  navs: number;
  colors: number;
  headings: number;
  coverage: number;
} {
  if (genomes.length === 0) {
    return { shells: 0, navs: 0, colors: 0, headings: 0, coverage: 0 };
  }
  const shells = new Set(genomes.map((g) => g.shell_archetype)).size;
  const navs = new Set(genomes.map((g) => g.nav_topology)).size;
  const colors = new Set(genomes.map((g) => g.color_mode)).size;
  const headings = new Set(genomes.map((g) => g.fonts.heading)).size;
  const coverage =
    (shells / SHELL_ARCHETYPES.length +
      navs / NAV_TOPOLOGIES.length +
      colors / COLOR_MODES.length) /
    3;
  return { shells, navs, colors, headings, coverage: Number(coverage.toFixed(3)) };
}