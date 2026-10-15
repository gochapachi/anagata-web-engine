/**
 * Guards for the design-skill sub-axis.
 *
 * The property that matters most here is NOT "a skill is picked" - any
 * implementation passes that. It is:
 *
 *   1. DETERMINISM. A re-run must not silently restyle a live tenant, so the
 *      pick is a pure function of (shell, seed).
 *   2. NO DEAD WEIGHT. Every vendored skill must be reachable by at least one
 *      shell, otherwise the registry grows and the new skills are invisible.
 *   3. NO TOKEN LEAKAGE. The agent prompt forbids hex codes and font names
 *      (HARD RULE 3) because the genome owns both. If a skill's substance
 *      carries either, the agent starts overriding the genome and two tenants
 *      on the same shell converge - the exact sameness this system prevents.
 *      This is asserted on the emitted block, not on the source file, because
 *      the block is what the agent actually sees.
 *   4. PRECEDENCE. The block must state the shell wins on disagreement, or the
 *      agent optimises for the skill's QA checklist instead of the shell.
 */
import { describe, expect, it } from 'vitest';

import {
  DESIGN_SKILLS,
  pickDesignSkill,
  designSkillBlock,
} from './design-skill-map';
import { SHELL_ARCHETYPES } from './genome';
import type { ShellArchetype } from './types';

const HEX = /#[0-9a-fA-F]{3,8}\b/;
// Font names that appear in the vendored registry. Matched case-sensitively
// because "inter" occurs in ordinary words ("interface", "interactive").
const FONT_NAMES =
  /(Plus Jakarta Sans|Playfair Display|IBM Plex Mono|JetBrains Mono|Ubuntu Mono|Gelasio|Poppins|Space Grotesk|DM Serif|Source Serif|Lora|Merriweather|Sora|Manrope|Outfit|Syne|Fraunces)/;

describe('design skill registry', () => {
  it('has the vendored skills loaded', () => {
    expect(DESIGN_SKILLS.length).toBeGreaterThanOrEqual(60);
  });

  it('every skill has substance text', () => {
    for (const skill of DESIGN_SKILLS) {
      expect(skill.substance.length, `${skill.slug} has empty substance`).toBeGreaterThan(200);
    }
  });
});

describe('pickDesignSkill', () => {
  it('is deterministic for a given shell + seed', () => {
    for (const shell of SHELL_ARCHETYPES as ShellArchetype[]) {
      const a = pickDesignSkill(shell, 'some-clinic-pune');
      const b = pickDesignSkill(shell, 'some-clinic-pune');
      expect(a.skill.slug, `${shell} picked differently across identical calls`).toBe(b.skill.slug);
    }
  });

  it('different seeds spread across more than one skill per shell', () => {
    // A picker that ignores the seed would hand every tenant on a shell the
    // same skill, reintroducing sameness one level down.
    for (const shell of SHELL_ARCHETYPES as ShellArchetype[]) {
      const slugs = new Set(
        ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map(
          (seed) => pickDesignSkill(shell, `${seed}-example-com`).skill.slug
        )
      );
      expect(slugs.size, `${shell} collapsed every seed onto ${[...slugs][0]}`).toBeGreaterThan(1);
    }
  });

  it('no skill is unreachable - the registry cannot gain dead weight', () => {
    const reachable = new Set<string>();
    for (const shell of SHELL_ARCHETYPES as ShellArchetype[]) {
      for (const seed of [
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l',
        'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x',
      ]) {
        reachable.add(pickDesignSkill(shell, `${seed}-tenant`).skill.slug);
      }
      // The explicit candidate list is the stronger check: a skill with real
      // affinity for a shell must be offered for that shell, not merely
      // reachable via some other shell's fallback.
      const { candidates } = pickDesignSkill(shell, 'probe-tenant');
      expect(candidates.length, `${shell} has no scored candidates`).toBeGreaterThan(0);
      for (const c of candidates) reachable.add(c);
    }
    const dead = DESIGN_SKILLS.map((s) => s.slug).filter((slug) => !reachable.has(slug));
    expect(dead, 'skills no shell can ever select').toEqual([]);
  });

  it('each shell prefers a stylistically coherent skill', () => {
    // Spot-check the judgement the keyword map encodes: glass must not be
    // paired with brutalist rules, and editorial must not be paired with glass.
    const clinical = new Set(
      ['alpha', 'bravo', 'charlie', 'delta'].map(
        (s) => pickDesignSkill('clinical-glass', `${s}-t`).skill.slug
      )
    );
    expect(clinical.has('brutalism')).toBe(false);
    expect(clinical.has('neobrutalism')).toBe(false);

    const brutalist = new Set(
      ['alpha', 'bravo', 'charlie', 'delta'].map(
        (s) => pickDesignSkill('swiss-brutalist', `${s}-t`).skill.slug
      )
    );
    expect(brutalist.has('glassmorphism')).toBe(false);
  });
});

describe('designSkillBlock', () => {
  const blocks = DESIGN_SKILLS.map((skill) => ({ skill, block: designSkillBlock(skill) }));

  it('never leaks a hex colour into the agent prompt', () => {
    const offenders = blocks.filter(({ block }) => HEX.test(block)).map(({ skill }) => skill.slug);
    expect(offenders, 'skills whose block contains a raw hex value').toEqual([]);
  });

  it('never leaks a font name into the agent prompt', () => {
    const offenders = blocks.filter(({ block }) => FONT_NAMES.test(block)).map(({ skill }) => skill.slug);
    expect(offenders, 'skills whose block names a typeface').toEqual([]);
  });

  it('states that the shell takes precedence', () => {
    for (const { skill, block } of blocks) {
      expect(block, `${skill.slug} block omits the precedence clause`).toContain('PRECEDENCE');
      expect(block, `${skill.slug} block does not name the shell as authoritative`).toMatch(
        /the SHELL above is authoritative/
      );
    }
  });

  it('drops the guideline-author framing that would make the agent write a design doc', () => {
    // The vendored SKILL.md files open with "You are an expert design-system
    // guideline author... Create practical, implementation-ready guidance".
    // Injected verbatim, that turns a page agent into a document writer.
    for (const { skill, block } of blocks) {
      expect(block, `${skill.slug} block still carries the guideline-author mission`).not.toMatch(
        /guideline author/i
      );
      expect(block, `${skill.slug} block still asks for implementation-ready guidance`).not.toMatch(
        /implementation-ready guidance/i
      );
    }
  });

  it('keeps the craft rules that are the whole point of the axis', () => {
    for (const { skill, block } of blocks) {
      // Not /WCAG/ - the vendored skills are inconsistent about naming the
      // standard. `power` writes "keyboard-first interactions, visible focus
      // states, semantic HTML before ARIA, 44px+ touch targets" with no WCAG
      // mention at all. What must survive sanitisation is the SECTION; asserting
      // the literal standard name failed on a skill that was carrying the rule.
      expect(block, `${skill.slug} block lost its accessibility section`).toMatch(
        /## Accessibility/
      );
      expect(block, `${skill.slug} block lost its Do rules`).toMatch(/Rules: Do/);
      expect(block, `${skill.slug} block lost its Don't rules`).toMatch(/Rules: Don't/);
    }
  });

  it('stays inside the prompt budget', () => {
    // ~1k tokens is the ceiling agreed for the injected block; the registry's
    // own tail boilerplate was stripped precisely to keep it there.
    const biggest = blocks.reduce((a, b) => (b.block.length > a.block.length ? b : a));
    expect(
      biggest.block.length,
      `${biggest.skill.slug} block is ${biggest.block.length} chars`
    ).toBeLessThan(4000);
  });
});