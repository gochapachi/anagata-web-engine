import type { DesignGenome, NavTopology, SiteRow } from '@/lib/types';

/**
 * Shared shell contract. Every shell renders the SAME props but must produce a
 * structurally different document: different container, different header model,
 * different section rhythm, different type scale.
 *
 * Rule for shells: they own LAYOUT ONLY. Colour and type come from the CSS
 * custom properties in `genome.tokens` + `genome.fonts`, so a shell never
 * hard-codes a hex or a font.
 */
export interface ShellProps {
  site: SiteRow;
  genome: DesignGenome;
  nav: NavItem[];
  brandName: string;
  cta?: { label: string; href: string } | null;
  /** Display phone number; shells use it in the utility strip / rail / footer. */
  phone?: string;
  footer: FooterColumn[];
  /** Set when compiled CSS should be inlined instead of linked. */
  compiledCss?: string;
  children: React.ReactNode;
}

export interface NavItem {
  label: string;
  href: string;
}

export interface FooterColumn {
  title: string;
  links: NavItem[];
}

/** Every shell must state which nav topologies it can render. */
export const SHELL_SUPPORTED_NAVS: Record<DesignGenome['shell_archetype'], NavTopology[]> = {
  'editorial-magazine': ['hairline-bar', 'split-centered', 'utility-strip', 'mega-matrix'],
  'swiss-brutalist': ['sidebar-rail', 'command-bar', 'hairline-bar', 'mega-matrix'],
  'clinical-glass': ['floating-pill', 'overlay-drawer', 'hairline-bar', 'utility-strip'],
  'warm-organic': ['split-centered', 'floating-pill', 'overlay-drawer', 'mega-matrix'],
  'bento-modular': ['command-bar', 'mega-matrix', 'floating-pill', 'hairline-bar'],
};

/**
 * Narrows a genome's nav topology to one the shell can actually render.
 * Prevents an unrenderable pair from shipping if the pools drift apart.
 */
export function effectiveNavTopology(
  shell: DesignGenome['shell_archetype'],
  requested: NavTopology
): NavTopology {
  const supported = SHELL_SUPPORTED_NAVS[shell];
  return supported.includes(requested) ? requested : supported[0];
}

/** CSS custom properties + font wiring, shared by all shells. */
export function genomeStyle(genome: DesignGenome): React.CSSProperties {
  const declarations = Object.entries(genome.tokens)
    .map(([name, value]) => `${name}:${value};`)
    .join('');
  return { '--genome-decls': declarations } as unknown as React.CSSProperties;
}

/** Fonts URL for a genome. Only the two faces actually used are requested. */
export function googleFontsHref(genome: DesignGenome): string {
  const { heading, body } = genome.fonts;
  const family = (name: string, weights: string) =>
    `family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${weights}`;
  return `https://fonts.googleapis.com/css2?${family(heading, '400;600;700')}&${family(
    body,
    '400;500;600;700'
  )}&display=swap`;
}