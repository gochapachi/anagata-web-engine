import { describe, it, expect } from 'vitest';
import {
  buildBannedSets,
  buildBrandColors,
  collides,
  COLOR_MODES,
  FLEET_CAPACITY,
  HEADING_FONTS,
  hashString,
  hueDistance,
  isBanned,
  NAV_TOPOLOGIES,
  PAIR_WINDOW,
  pairKey,
  parseSignature,
  pickAxisValue,
  pickGenome,
  PROVEN_WORST_CASE,
  RHYTHM_VARIANTS,
  SHELL_ARCHETYPES,
  SHELL_PROFILES,
  signatureEntry,
  SIMILARITY_LIMIT,
  similarityTo,
  structuralCoverage,
  structureSignature,
  toSignatureEntry,
  violatesSimilarity,
  type RecentUsage,
} from './genome';
import type { DesignGenome } from './types';

/**
 * Simulates the real tenant registry: every generated site joins the history it
 * was scored against, exactly as the n8n workflow will do against Supabase.
 */
function generateSeries(count: number, niche = 'dental-clinic', city = 'New Delhi'): DesignGenome[] {
  const history: DesignGenome[] = [];
  const rhythms: string[] = [];
  for (let i = 0; i < count; i++) {
    const recent: RecentUsage = {
      structure: history.map((g, idx) => toSignatureEntry(g, rhythms[idx])),
      headings: history.map((g) => g.fonts.heading),
      bodies: history.map((g) => g.fonts.body),
      hues: [],
    };
    const g = pickGenome({ seed: `site-${i}`, niche, city }, recent);
    history.push(g);
    rhythms.push(g._rhythm);
  }
  return history;
}

describe('rankAxisValues / pickAxisValue', () => {
  it('prefers a never-used value over any used one', () => {
    const recent = ['a', 'b', 'c'];
    expect(recent).not.toContain(pickAxisValue(['a', 'b', 'c', 'd', 'e'], recent, 'seed', 't'));
  });

  it('is deterministic for the same seed', () => {
    expect(pickAxisValue(SHELL_ARCHETYPES, [], 'same-seed', 'shell')).toBe(
      pickAxisValue(SHELL_ARCHETYPES, [], 'same-seed', 'shell')
    );
  });

  it('breaks ties so different seeds reach different values', () => {
    const distinct = new Set(
      Array.from({ length: 25 }, (_, i) => pickAxisValue(SHELL_ARCHETYPES, [], `seed-${i}`, 'shell'))
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('prefers the least recently used value amongst used ones', () => {
    expect(pickAxisValue(['a', 'b'], ['b', 'a'], 'seed', 't')).toBe('b');
  });
});

describe('pool sizes back the guarantee', () => {
  it('has enough heading fonts for the pair window', () => {
    expect(HEADING_FONTS.length).toBeGreaterThan(PAIR_WINDOW);
  });

  it('has a heading pool large enough to avoid repeats across the window', () => {
    expect(HEADING_FONTS.length).toBeGreaterThanOrEqual(PAIR_WINDOW * 2);
  });

  it('FLEET_CAPACITY exceeds any realistic fleet', () => {
    expect(FLEET_CAPACITY).toBeGreaterThanOrEqual(1000);
  });

  it('FLEET_CAPACITY is the product of the pool sizes', () => {
    expect(FLEET_CAPACITY).toBe(
      SHELL_ARCHETYPES.length * NAV_TOPOLOGIES.length * COLOR_MODES.length * RHYTHM_VARIANTS.length
    );
  });
});

describe('structureSignature / isBanned / pairKey', () => {
  const bentoFloatingWarm = {
    shell_archetype: 'bento-modular' as const,
    nav_topology: 'floating-pill' as const,
    color_mode: 'light-warm' as const,
  };

  it('builds shell|nav|color', () => {
    expect(structureSignature(bentoFloatingWarm)).toBe('bento-modular|floating-pill|light-warm');
  });

  it('bans an exact triple present in the history', () => {
    expect(isBanned(bentoFloatingWarm, ['bento-modular|floating-pill|light-warm'])).toBe(true);
  });

  it('B2: bans a candidate sharing shell+nav with a window site, at another colour', () => {
    expect(
      isBanned({ ...bentoFloatingWarm, color_mode: 'duotone-sand' }, [
        'bento-modular|floating-pill|light-warm',
      ])
    ).toBe(true);
  });

  it('B3: bans a candidate sharing shell+colour with a window site', () => {
    expect(
      isBanned(
        { shell_archetype: 'warm-organic', nav_topology: 'overlay-drawer', color_mode: 'duotone-sand' },
        ['warm-organic|hairline-bar|duotone-sand']
      )
    ).toBe(true);
  });

  it('allows a candidate sharing neither shell+nav nor shell+colour', () => {
    expect(
      isBanned(
        { shell_archetype: 'clinical-glass', nav_topology: 'sidebar-rail', color_mode: 'light-cool' },
        ['warm-organic|hairline-bar|duotone-sand']
      )
    ).toBe(false);
  });

  it('B1: keeps a triple reserved far beyond the pair window', () => {
    const old = 'bento-modular|floating-pill|light-warm|divided-columns';
    const filler = Array.from(
      { length: PAIR_WINDOW + 25 },
      (_, i) => `editorial-magazine|hairline-bar|dark-ink|stacked-bands#${i}`
    );
    expect(isBanned(bentoFloatingWarm, [old, ...filler])).toBe(true);
  });

  it('forgets a triple once FLEET_CAPACITY sites have passed', () => {
    const old = 'bento-modular|floating-pill|light-warm|divided-columns';
    const filler = Array.from(
      { length: FLEET_CAPACITY },
      (_, i) => `editorial-magazine|hairline-bar|dark-ink|stacked-bands#${i}`
    );
    expect(isBanned(bentoFloatingWarm, [old, ...filler])).toBe(false);
  });

  it('only looks back PAIR_WINDOW sites for pair bans', () => {
    const recent = [
      'bento-modular|floating-pill|duotone-sand|divided-columns',
      ...Array.from(
        { length: PAIR_WINDOW },
        (_, i) => `clinical-glass|sidebar-rail|light-cool|gallery-scroll#${i}`
      ),
    ].slice(PAIR_WINDOW * -1);
    expect(isBanned({ ...bentoFloatingWarm, color_mode: 'dark-ink' }, recent)).toBe(false);
  });

  it('pairKey is injective even when values contain the separator', () => {
    expect(pairKey('a', 'b')).not.toBe(pairKey('ab', ''));
    expect(pairKey('a^^', 'b')).not.toBe(pairKey('a', '^^b'));
    expect(pairKey('same', 'same')).toBe(pairKey('same', 'same'));
  });

  it('parseSignature round-trips a four-part entry', () => {
    const parsed = parseSignature('warm-organic|mega-matrix|paper-ink|sticky-split');
    expect(parsed.shell_archetype).toBe('warm-organic');
    expect(parsed.nav_topology).toBe('mega-matrix');
    expect(parsed.color_mode).toBe('paper-ink');
    expect(parsed.rhythm).toBe('sticky-split');
  });

  it('collides() and isBanned() agree', () => {
    const history = ['bento-modular|floating-pill|light-warm|divided-columns'];
    expect(collides(bentoFloatingWarm, buildBannedSets(history))).toBe(isBanned(bentoFloatingWarm, history));
  });

  it('signatureEntry carries the rhythm', () => {
    const g = pickGenome({ seed: 'sig', niche: 'n', city: 'c' });
    expect(signatureEntry(g).signature.split('|')).toHaveLength(4);
  });
});

describe('the documented similarity bound', () => {
  it('PROVEN_WORST_CASE clears SIMILARITY_LIMIT', () => {
    expect(PROVEN_WORST_CASE).toBeCloseTo(0.43, 5);
    expect(SIMILARITY_LIMIT).toBe(0.45);
    expect(PROVEN_WORST_CASE).toBeLessThan(SIMILARITY_LIMIT);
  });

  it('weights sum to exactly 1.0 so an identical pair scores 1', () => {
    const g = pickGenome({ seed: 'dup', niche: 'n', city: 'c' });
    expect(similarityTo(g, [g]).max).toBe(1);
  });

  it('same-shell-only scores 0.43 through similarityTo', () => {
    const a = pickGenome({ seed: 'sh-a', niche: 'n', city: 'c' });
    const b: DesignGenome = {
      ...a,
      nav_topology: 'sidebar-rail',
      color_mode: 'dark-ink',
      fonts: { ...a.fonts, heading: 'Another Unused Heading' },
    };
    expect(similarityTo(b, [a]).max).toBeCloseTo(0.43, 3);
  });

  it('same nav + colour with a different shell and heading scores 0.37', () => {
    const a = pickGenome({ seed: 'nc-a', niche: 'n', city: 'c' });
    const b: DesignGenome = {
      ...a,
      shell_archetype: 'warm-organic',
      fonts: { ...a.fonts, heading: 'Yet Another Unused Heading' },
    };
    expect(similarityTo(b, [a]).max).toBeCloseTo(0.37, 3);
  });
});

describe('anti-sameness across a generated fleet', () => {
  const FLEET = 120;

  it('gives every one of 120 sites a unique structural triple', () => {
    const history = generateSeries(FLEET);
    expect(new Set(history.map((g) => structureSignature(g))).size).toBe(FLEET);
  });

  it('gives every site a unique full fingerprint', () => {
    const history = generateSeries(FLEET);
    const fingerprints = new Set(
      history.map((g) =>
        [
          g.shell_archetype,
          g.nav_topology,
          g.color_mode,
          g.spacing_scale,
          g.motion_profile,
          g.fonts.heading,
          g.fonts.body,
        ].join('~')
      )
    );
    expect(fingerprints.size).toBe(FLEET);
  });

  it('GUARANTEE 1a: ZERO identical pairs inside any window', () => {
    const history = generateSeries(FLEET);
    for (let i = 1; i < history.length; i++) {
      const window = history.slice(Math.max(0, i - PAIR_WINDOW), i);
      for (const other of window) {
        expect(similarityTo(history[i], [other]).max).toBeLessThan(0.5);
      }
    }
  });

  it('GUARANTEE 1b: similarity stays below the limit in every window', () => {
    const history = generateSeries(FLEET);
    for (let i = 1; i < history.length; i++) {
      const window = history.slice(Math.max(0, i - PAIR_WINDOW), i);
      const { max, breakdown } = similarityTo(history[i], window);
      expect(max, `site ${i} too similar (${breakdown.join(', ')})`).toBeLessThan(SIMILARITY_LIMIT);
    }
  });

  it('never repeats a (shell, nav) pair inside the window', () => {
    const history = generateSeries(FLEET);
    for (let i = 1; i < history.length; i++) {
      for (const other of history.slice(Math.max(0, i - PAIR_WINDOW), i)) {
        expect(`${other.shell_archetype}|${other.nav_topology}`).not.toBe(
          `${history[i].shell_archetype}|${history[i].nav_topology}`
        );
      }
    }
  });

  it('never repeats a (shell, colour) pair inside the window', () => {
    const history = generateSeries(FLEET);
    for (let i = 1; i < history.length; i++) {
      for (const other of history.slice(Math.max(0, i - PAIR_WINDOW), i)) {
        expect(`${other.shell_archetype}|${other.color_mode}`).not.toBe(
          `${history[i].shell_archetype}|${history[i].color_mode}`
        );
      }
    }
  });

  it('never repeats a heading font inside the window', () => {
    const history = generateSeries(FLEET);
    for (let i = 1; i < history.length; i++) {
      const window = history.slice(Math.max(0, i - PAIR_WINDOW), i).map((g) => g.fonts.heading);
      expect(window).not.toContain(history[i].fonts.heading);
    }
  });

  it('GUARANTEE 2: no two sites in a 300-site fleet are identical', () => {
    const history = generateSeries(300);
    const triples = history.map((g) => structureSignature(g));
    expect(new Set(triples).size).toBe(triples.length);
  });

  it('covers every shell, nav and colour mode', () => {
    const { shells, navs, colors, coverage } = structuralCoverage(generateSeries(FLEET));
    expect(shells).toBe(SHELL_ARCHETYPES.length);
    expect(navs).toBe(NAV_TOPOLOGIES.length);
    expect(colors).toBe(COLOR_MODES.length);
    expect(coverage).toBe(1);
  });

  it('spreads shells evenly across the fleet', () => {
    const history = generateSeries(FLEET);
    const counts = new Map<string, number>();
    for (const g of history) counts.set(g.shell_archetype, (counts.get(g.shell_archetype) ?? 0) + 1);
    for (const [shell, n] of counts) {
      expect(n / history.length, `${shell} over-represented`).toBeLessThanOrEqual(0.25);
    }
  });

  it('keeps a same-niche, same-city burst diversified (worst case for sameness)', () => {
    const history = generateSeries(30, 'dental-clinic', 'South Delhi');
    expect(new Set(history.map((g) => structureSignature(g))).size).toBe(30);
  });

  it('reaches all 8 nav topologies in a 120-site fleet', () => {
    const history = generateSeries(FLEET);
    expect(new Set(history.map((g) => g.nav_topology)).size).toBe(8);
  });

  it('reaches all 12 colour modes in a 120-site fleet', () => {
    const history = generateSeries(FLEET);
    expect(new Set(history.map((g) => g.color_mode)).size).toBe(12);
  });
});

describe('buildBrandColors', () => {
  it('emits parseable hsl() with a white-on-primary text token on light palettes', () => {
    const brand = buildBrandColors('crown-dental');
    expect(brand.primary).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(brand.accent).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(brand.primaryContrastText).toBe('#FFFFFF');
  });

  it('uses dark text on a lightened primary for dark palettes', () => {
    const brand = buildBrandColors('crown-dental', [], true);
    expect(brand.primary).toContain('% 62%)');
    expect(brand.primaryContrastText).toBe('#0A0A0B');
  });

  it('avoids recently used hues', () => {
    const used = [10, 100, 200];
    const { hue } = buildBrandColors('crown-dental', used);
    for (const h of used) expect(hueDistance(hue, h)).toBeGreaterThan(24);
  });

  it('pins light-palette primary lightness to 34% for contrast', () => {
    expect(buildBrandColors('anything').primary).toContain('% 34%)');
  });

  it('gives different brands different hues', () => {
    const hues = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => buildBrandColors(s).hue));
    expect(hues.size).toBeGreaterThanOrEqual(6);
  });
});

describe('tokens and profiles', () => {
  it('emits every token the shells reference', () => {
    const genome = pickGenome({ seed: 'x', niche: 'law-firm', city: 'Pune' });
    for (const token of [
      '--bg-canvas',
      '--bg-surface',
      '--bg-contrast',
      '--text-primary',
      '--text-muted',
      '--brand-primary',
      '--brand-accent',
      '--on-brand',
      '--radius-card',
      '--radius-button',
      '--container-width',
      '--section-gap',
      '--display-scale',
    ]) {
      expect(genome.tokens[token], token).toBeTruthy();
    }
  });

  it('couples spacing and motion to the shell instead of picking them freely', () => {
    for (const g of generateSeries(20)) {
      expect(g.spacing_scale).toBe(SHELL_PROFILES[g.shell_archetype].spacing_scale);
      expect(g.motion_profile).toBe(SHELL_PROFILES[g.shell_archetype].motion_profile);
    }
  });

  it('exposes the chosen rhythm', () => {
    expect(RHYTHM_VARIANTS).toContain(pickGenome({ seed: 'rh', niche: 'n', city: 'c' })._rhythm);
  });

  it('documents a rationale', () => {
    const rationale = pickGenome({ seed: 'r', niche: 'n', city: 'c' })._rationale;
    expect(rationale).toContain('shell=');
    expect(rationale).toContain('rhythm=');
  });

  it('hashString is stable and seed-sensitive', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('similarityTo edge cases', () => {
  it('returns 0 for an empty history', () => {
    expect(similarityTo(pickGenome({ seed: 'solo', niche: 'n', city: 'c' }), []).max).toBe(0);
  });

  it('reports the worst index and a breakdown', () => {
    const a = pickGenome({ seed: 'w-a', niche: 'n', city: 'c' });
    const b = pickGenome({ seed: 'w-b', niche: 'n', city: 'c' });
    const { worstIndex, breakdown } = similarityTo(a, [b, a]);
    expect(worstIndex).toBe(1);
    expect(breakdown.length).toBeGreaterThan(0);
  });

  it('violatesSimilarity is false for an empty history', () => {
    expect(violatesSimilarity(pickGenome({ seed: 'v', niche: 'n', city: 'c' }), [])).toBe(false);
  });
});