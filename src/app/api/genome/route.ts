import { NextRequest, NextResponse } from 'next/server';
import {
  buildBrandColors,
  pickGenome,
  SHELL_ARCHETYPES,
  NAV_TOPOLOGIES,
  COLOR_MODES,
  RHYTHM_VARIANTS,
  HEADING_FONTS,
  BODY_FONTS,
  FLEET_CAPACITY,
  PAIR_WINDOW,
  SIMILARITY_LIMIT,
  PROVEN_WORST_CASE,
  SHELL_PROFILES,
  similarityTo,
  structuralCoverage,
  toSignatureEntry,
  type RecentUsage,
} from '@/lib/genome';
import type { DesignGenome } from '@/lib/types';
import { fetchRecentSites } from '@/lib/supabase';
import { pickDesignSkill, designSkillBlock } from '@/lib/design-skill-map';

/**
 * Design-genome service, called by the n8n site-builder workflow.
 *
 * GET  - returns the pools, weights and limits so the workflow prompt can state
 *        exactly what is allowed without hard-coding lists in n8n.
 * POST - given a tenant descriptor and the recent fleet, returns a genome that
 *        has been checked against the anti-sameness guarantee.
 *
 * The ban list is passed IN by the workflow (it already fetched the fleet to
 * render the prompt), but the endpoint also falls back to reading Supabase when
 * `useLedger: true`, so the check cannot be skipped by an incomplete payload.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    shells: SHELL_ARCHETYPES,
    navs: NAV_TOPOLOGIES,
    colors: COLOR_MODES,
    rhythms: RHYTHM_VARIANTS,
    heading_fonts: HEADING_FONTS,
    body_fonts: BODY_FONTS,
    shell_profiles: SHELL_PROFILES,
    limits: {
      fleet_capacity: FLEET_CAPACITY,
      pair_window: PAIR_WINDOW,
      similarity_limit: SIMILARITY_LIMIT,
      proven_worst_case: PROVEN_WORST_CASE,
    },
  });
}

interface GenomeRequest {
  seed?: string;
  niche?: string;
  city?: string;
  useLedger?: boolean;
  /** Explicit history, each entry `shell|nav|color|rhythm`. */
  recent?: string[];
  recentHeadings?: string[];
  recentBodies?: string[];
  recentHues?: number[];
}

export async function POST(req: NextRequest) {
  let body: GenomeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const seed = String(body.seed ?? '').trim();
  const niche = String(body.niche ?? 'professional-services').trim();
  const city = String(body.city ?? '').trim();
  if (!seed) {
    return NextResponse.json({ error: 'seed is required (use the tenant slug or domain)' }, { status: 422 });
  }

  let recent: RecentUsage = {
    structure: body.recent ?? [],
    headings: body.recentHeadings ?? [],
    bodies: body.recentBodies ?? [],
    hues: body.recentHues ?? [],
  };

  // Prefer the live ledger so the guarantee cannot be sidestepped by an empty
  // payload from the workflow.
  if (body.useLedger !== false) {
    try {
      const sites = await fetchRecentSites(Math.max(FLEET_CAPACITY, PAIR_WINDOW * 4), niche);
      if (sites.length) {
        recent = {
          structure: sites
            .map((site) => site.design_genome as DesignGenome | undefined)
            .filter((genome): genome is DesignGenome => Boolean(genome?.shell_archetype))
            .map((genome) => toSignatureEntry(genome, (genome as any)._rhythm))
            .reverse(),
          headings: sites
            .map((site) => (site.design_genome as DesignGenome | undefined)?.fonts?.heading)
            .filter((value): value is string => Boolean(value))
            .reverse(),
          bodies: sites
            .map((site) => (site.design_genome as DesignGenome | undefined)?.fonts?.body)
            .filter((value): value is string => Boolean(value))
            .reverse(),
          hues: sites
            .map((site) => (site.design_genome as any)?._hue)
            .filter((value): value is number => typeof value === 'number'),
        };
      }
    } catch (error: any) {
      // Degrade to the supplied history rather than failing the workflow.
      if (!recent.structure.length) {
        return NextResponse.json(
          { error: `Could not read the design ledger: ${error?.message ?? error}` },
          { status: 503 }
        );
      }
    }
  }

  const genome = pickGenome({ seed, niche, city }, recent);

  // The design skill is a SUB-AXIS of the shell: it fills the craft gaps the
  // shell leaves open (state coverage, spacing discipline, anti-patterns). It
  // cannot weaken bans B1-B4 because it is not part of structureSignature().
  const { skill, candidates } = pickDesignSkill(genome.shell_archetype, seed);

  const priorGenomes: DesignGenome[] = (body.recent ?? []).map((signature) => {
    const [shell_archetype, nav_topology, color_mode] = signature.split('|');
    return {
      shell_archetype: shell_archetype as DesignGenome['shell_archetype'],
      nav_topology: nav_topology as DesignGenome['nav_topology'],
      color_mode: color_mode as DesignGenome['color_mode'],
      spacing_scale: genome.spacing_scale,
      motion_profile: genome.motion_profile,
      tokens: {},
      fonts: { heading: '\u0000', body: '\u0000' },
    };
  });

  const similarity = similarityTo(genome, priorGenomes.slice(-PAIR_WINDOW));

  return NextResponse.json({
    genome,
    rhythm: genome._rhythm,
    rationale: genome._rationale,
    // Craft layer: one vendored design skill whose declared style is
    // compatible with the shell. `block` is pre-rendered prompt text; the
    // workflow injects it verbatim into the page agent's brief.
    design_skill: {
      slug: skill.slug,
      name: skill.name,
      block: designSkillBlock(skill),
      candidates,
    },
    // The workflow should refuse to publish when `similarity_ok` is false. It
    // cannot legitimately be false with a correct ban list, which is the point:
    // a false value means the ledger read failed.
    similarity_ok: similarity.max < SIMILARITY_LIMIT,
    similarity,
    coverage: structuralCoverage([
      ...priorGenomes,
      genome,
    ]),
    brand: buildBrandColors(seed, recent.hues ?? []),
  });
}