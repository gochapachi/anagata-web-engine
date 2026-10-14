/**
 * Shared row shapes for the engine. These mirror the SQL in
 * supabase/migrations/001_multi_tenant_schema.sql - keep both in sync.
 */

/** Structural page skeleton. These are the 5 layout archetypes. */
export type ShellArchetype =
  | 'editorial-magazine'
  | 'swiss-brutalist'
  | 'clinical-glass'
  | 'warm-organic'
  | 'bento-modular';

/** Header shape and navigation model. 8 genuinely different head models. */
export type NavTopology =
  | 'floating-pill'
  | 'hairline-bar'
  | 'sidebar-rail'
  | 'split-centered'
  | 'overlay-drawer'
  | 'utility-strip'
  | 'mega-matrix'
  | 'command-bar';

/**
 * Surface strategy: the shared substrate behind a whole category - background
 * family, contrast direction, and panel treatment. Drives palette selection.
 */
export type ColorMode =
  | 'light-warm'
  | 'light-cool'
  | 'light-neutral'
  | 'light-tinted'
  | 'paper-ink'
  | 'light-editorial'
  | 'dark-contrast'
  | 'dark-slate'
  | 'dark-ink'
  | 'dark-aurora'
  | 'duotone-sand'
  | 'duotone-forest';

/** Spacing rhythm. Coupled to the shell, not picked independently. */
export type SpacingScale = 'compact' | 'standard' | 'editorial-wide' | 'full-bleed';

/** Animation physics. Coupled to the shell, not picked independently. */
export type MotionProfile = 'none' | 'spring-snappy' | 'editorial-curtain' | 'scroll-parallax';

/** Named spacing-rhythm variants the page agent can target. */
export type RhythmVariant =
  | 'divided-columns'
  | 'stacked-bands'
  | 'magazine-gutter'
  | 'gallery-scroll'
  | 'sticky-split'
  | 'numbered-stack'
  | 'asymmetric-offset'
  | 'fullbleed-diagonal';

export interface DesignGenome {
  shell_archetype: ShellArchetype;
  nav_topology: NavTopology;
  spacing_scale: SpacingScale;
  motion_profile: MotionProfile;
  color_mode: ColorMode;
  /** CSS custom properties applied to :root for the tenant. */
  tokens: Record<string, string>;
  fonts: { heading: string; body: string; mono?: string };
}

export interface SiteRow {
  id: string;
  slug: string;
  domain: string;
  preview_subdomain: string;
  niche: string;
  city: string;
  business_info: Record<string, any>;
  design_genome: DesignGenome;
  navigation: Record<string, any>;
  seo_global: Record<string, any>;
  status: 'draft' | 'preview' | 'live' | 'suspended';
}

export interface PageSection {
  /** Registry block id when the section uses a pre-built component. */
  block?: string;
  /** Free-form props handed to the block component. */
  props?: Record<string, any>;
  /** AI-authored MDX, rendered when `block` is absent. */
  mdx?: string;
  /** Anchor id so navigation can deep-link. */
  anchor?: string;
}

export interface PageRow {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  seo_meta: Record<string, any>;
  sections: PageSection[];
  compiled_css: string;
  published: boolean;
}

export interface PostRow {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  excerpt: string;
  content_mdx: string;
  compiled_css: string;
  cover_image: string | null;
  category: string;
  tags: string[];
  author: Record<string, any>;
  seo_meta: Record<string, any>;
  reading_time_mins: number;
  status: 'draft' | 'published';
  published_at: string;
}