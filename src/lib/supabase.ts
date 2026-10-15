/**
 * Supabase REST access.
 *
 * Uses PostgREST over fetch rather than the supabase-js client: the engine only
 * needs reads (plus one insert from the leads route), and a dependency-free
 * layer keeps the standalone container small and the data flow explicit.
 *
 * Every read is wrapped in `unstable_cache` with a per-tenant tag so an n8n
 * publish can invalidate one tenant without touching the other 49.
 */

import { unstable_cache } from 'next/cache';
import type { PageRow, PostRow, SiteRow } from './types';
import { normalizeHost } from './domain';

const SUPABASE_URL = () => (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const siteTag = (domain: string) => `site:${domain}`;
export const postTag = (domain: string, slug: string) => `post:${domain}:${slug}`;

export class SupabaseError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SupabaseError';
  }
}

/**
 * Minimal PostgREST call. `query` is a raw PostgREST query string, e.g.
 * `select=*&domain=eq.example.com&limit=1`.
 */
export async function postgrest<T>(
  path: string,
  query: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${SUPABASE_URL()}/rest/v1/${path}?${query}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY(),
      Authorization: `Bearer ${SUPABASE_KEY()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new SupabaseError(`PostgREST ${path} failed (${response.status}): ${body.slice(0, 400)}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Escapes a value for a PostgREST `eq.` filter. */
export function eq(value: string): string {
  return `eq.${encodeURIComponent(value)}`;
}

/**
 * Resolves a tenant from a Host header. Accepts either the production `domain`
 * or the `preview_subdomain`, so a site is reachable the instant it is created.
 */
/**
 * Resolves a tenant from a Host header. Accepts:
 *   - the production `domain` (thecrowndentalclinic.com)
 *   - the `preview_subdomain` exactly as stored
 *   - `<slug>.anagataitsolutions.in`, the CURRENT preview shape
 *
 * WHY THE SLUG FALLBACK MATTERS: the preview host is derived from
 * SITES_BASE_DOMAIN, and existing rows were written when that was
 * `sites.anagataitsolutions.in` (a TWO-label host). Changing the env var moved
 * previews to `<slug>.anagataitsolutions.in`, but no migration touched the stored
 * `preview_subdomain` - so every existing tenant 404'd on its own new preview
 * URL while the engine was perfectly healthy. Matching the slug recovers those
 * rows without a data migration, and keeps working if the preview domain changes
 * again later.
 */
export async function fetchSite(host: string): Promise<SiteRow | null> {
  const encoded = encodeURIComponent(host);
  const rows = await postgrest<SiteRow[]>(
    'sites',
    `select=*&or=(domain.eq.${encoded},preview_subdomain.eq.${encoded})&status=neq.suspended&limit=1`
  );
  if (rows[0]) return rows[0];

  // Fallback: a preview host whose slug is the first label.
  const base = previewBaseDomain();
  if (!host.endsWith(`.${base}`)) return null;

  const slug = host.slice(0, -(base.length + 1));
  // A preview slug never contains a dot; anything deeper is not ours.
  if (!slug || slug.includes('.')) return null;

  const bySlug = await postgrest<SiteRow[]>(
    'sites',
    // `slug=eq.` NOT `slug.eq.`. The dot form is not PostgREST filter syntax: the
    // parameter is ignored entirely and the query returns the FIRST row of the
    // table, so every tenant resolved to the oldest site - all ten previews
    // rendered 'Fix Verify Dental'. Silent, because the request still returns 200
    // with a valid-looking row.
    `select=*&slug=eq.${encodeURIComponent(slug)}&status=neq.suspended&limit=1`
  );
  return bySlug[0] ?? null;
}

/** The apex previews live under, read from config. */
function previewBaseDomain(): string {
  return (process.env.SITES_BASE_DOMAIN ?? 'anagataitsolutions.in')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

/**
 * Cached tenant lookup, keyed by the NORMALIZED host.
 *
 * WHY NORMALIZE BEFORE CACHING: the cache key must be the tenant's identity, not
 * whatever string happened to arrive. Hosts reach us in several equivalent forms -
 * the client domain, the stored `preview_subdomain` (which for older rows is the
 * stale two-label value), or a bare `<slug>.<SITES_BASE_DOMAIN>`. Keying on the
 * raw string meant those variants did not share one identity, and because
 * Next.js' Data Cache is shared across every visitor, the first tenant resolved
 * was reused for every host: all ten previews rendered "Fix Verify Dental", the
 * oldest row, while the database held ten correct, distinct tenants.
 *
 * Normalizing first collapses every equivalent form onto ONE key, so each tenant
 * occupies its own cache slot and can never answer another tenant's request.
 */
export const getSite = (host: string) => {
  const normalized = normalizeHost(host);
  return unstable_cache(
    () => fetchSite(normalized),
    ['site', normalized],
    { tags: [siteTag(normalized)], revalidate: 3600 }
  )();
};

/**
 * Single page by slug. `slug` is normalized (`/` for home).
 *
 * The host is normalized BEFORE it enters the cache key and the invalidation tag.
 * A raw host meant the tag written by /api/revalidate (`site:<normalized>`) and
 * the tag on the cached entry (`site:<raw>`) could differ, so a republish would
 * not actually purge the page it targeted - and two host variants of the same
 * tenant would occupy separate slots.
 */
export const getPage = (host: string, siteId: string, slug: string) => {
  const normalized = normalizeHost(host);
  const isHome = !slug || slug === '/' || slug === '';
  return unstable_cache(
    async (): Promise<PageRow | null> => {
      const slugClause = isHome
        ? 'or=(slug.eq.,slug.eq.%2F)'
        : `slug=${eq(slug)}`;
      const rows = await postgrest<PageRow[]>(
        'pages',
        `select=*&site_id=${eq(siteId)}&${slugClause}&published=is.true&limit=1`
      );
      return rows[0] ?? null;
    },
    ['page', normalized, isHome ? '/' : slug],
    { tags: [siteTag(normalized)], revalidate: 3600 }
  )();
};

/** All published pages for a tenant (used to build nav + sitemap). */
export const getPages = (host: string, siteId: string) => {
  const normalized = normalizeHost(host);
  return unstable_cache(
    async (): Promise<PageRow[]> =>
      postgrest<PageRow[]>(
        'pages',
        `select=id,slug,title,seo_meta&site_id=${eq(siteId)}&published=is.true&order=slug.asc`
      ),
    ['pages', normalized],
    { tags: [siteTag(normalized)], revalidate: 3600 }
  )();
};

/** Published posts, newest first. */
export const getPosts = (host: string, siteId: string, limit = 100) => {
  const normalized = normalizeHost(host);
  return unstable_cache(
    async (): Promise<PostRow[]> =>
      postgrest<PostRow[]>(
        'posts',
        `select=id,slug,title,excerpt,cover_image,category,tags,author,published_at,reading_time_mins&site_id=${eq(siteId)}&status=eq.published&order=published_at.desc&limit=${limit}`
      ),
    ['posts', normalized, String(limit)],
    { tags: [siteTag(normalized)], revalidate: 3600 }
  )();
};

/** Single published post including its MDX body. */
export const getPost = (host: string, siteId: string, slug: string) => {
  const normalized = normalizeHost(host);
  return unstable_cache(
    async (): Promise<PostRow | null> => {
      const rows = await postgrest<PostRow[]>(
        'posts',
        `select=*&site_id=${eq(siteId)}&slug=${eq(slug)}&status=eq.published&limit=1`
      );
      return rows[0] ?? null;
    },
    ['post', host, slug],
    { tags: [siteTag(host), postTag(host, slug)], revalidate: 3600 }
  )();
};

/** Recent tenants, for the workflow's anti-sameness diversity check. */
export async function fetchRecentSites(limit: number, niche?: string): Promise<SiteRow[]> {
  const nicheFilter = niche ? `&niche=${eq(niche)}` : '';
  return postgrest<SiteRow[]>(
    'sites',
    `select=id,slug,domain,niche,city,design_genome,created_at&order=created_at.desc&limit=${limit}${nicheFilter}`
  );
}

/** Inserts a lead row. Returns the created id. */
export async function insertLead(row: Record<string, unknown>): Promise<{ id: string }[]> {
  return postgrest<{ id: string }[]>('leads', 'select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
}

/** Counts recent leads from one (site, ip_hash) pair, for rate limiting. */
export async function countRecentLeads(
  siteId: string,
  ipHash: string,
  sinceIso: string
): Promise<number> {
  const rows = await postgrest<{ id: string }[]>(
    'leads',
    `select=id&site_id=${eq(siteId)}&ip_hash=${eq(ipHash)}&created_at=gte.${encodeURIComponent(sinceIso)}`
  );
  return rows.length;
}