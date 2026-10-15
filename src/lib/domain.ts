/**
 * Multi-tenant host resolution.
 *
 * Every public request arrives with a Host header for a client domain
 * (e.g. thecrowndentalclinic.com). Middleware rewrites it into the private
 * `/sites/[domain]/...` route segment so one container serves all tenants.
 *
 * Pure functions only - no Next.js imports - so they are unit-testable.
 */

/** Anything not a client domain: local dev, the engine's own host, bare IPs. */
const ENGINE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'sites.anagataitsolutions.in',
  'anagata-web-engine',
]);

/**
 * Lowercases, trims, drops the port, and strips a single leading `www.`.
 * `www.thecrowndentalclinic.com:3000` -> `thecrowndentalclinic.com`
 */
export function normalizeHost(rawHost: string | null | undefined): string {
  if (!rawHost) return 'localhost';
  return rawHost
    .toLowerCase()
    .trim()
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

/** True when the host is engine infrastructure rather than a client tenant. */
export function isEngineHost(host: string): boolean {
  const h = normalizeHost(host);
  if (ENGINE_HOSTS.has(h)) return true;
  // The wildcard preview domain is a tenant carrier, not an engine host:
  // <slug>.sites.anagataitsolutions.in must resolve to its tenant.
  return false;
}

/**
 * `preview_subdomain` value for a tenant slug, used for instant preview URLs.
 *
 * Read from SITES_BASE_DOMAIN rather than hardcoded: the preview host must be
 * ONE label below the apex. The old value `sites.anagataitsolutions.in` produced
 * `<slug>.sites.anagataitsolutions.in` - TWO labels down - which no wildcard
 * certificate covers (the Cloudflare wildcard is `*.anagataitsolutions.in`, one
 * level only). Every preview URL failed with ERR_SSL_VERSION_OR_CIPHER_MISMATCH.
 *
 * Set SITES_BASE_DOMAIN=anagataitsolutions.in so previews land at
 * `<slug>.anagataitsolutions.in`, inside the existing wildcard.
 */
export function previewSubdomainFor(slug: string): string {
  const base = (process.env.SITES_BASE_DOMAIN ?? 'anagataitsolutions.in')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return `${slug}.${base}`;
}

/**
 * Maps a public path to the private tenant route segment.
 * `/` -> `/sites/<host>` and `/blog/x?y=1` -> `/sites/<host>/blog/x`
 * (the query string is appended by the caller, which owns the URL object).
 */
export function resolveInternalRewritePath(host: string, pathname: string): string {
  const cleanHost = normalizeHost(host);
  const cleanPath = pathname === '/' ? '' : pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `/sites/${cleanHost}${cleanPath}`;
}

/** Extracts the tenant host back out of a /sites/<host>/... path. */
export function tenantFromInternalPath(pathname: string): { host: string; rest: string } | null {
  const match = /^\/sites\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  return { host: decodeURIComponent(match[1]), rest: match[2] ?? '/' };
}

/**
 * Trailing-slash-insensitive canonical slug for a page row.
 * `/` stays `/`; `about/` and `about` both become `about`.
 */
export function normalizeSlug(slug: string): string {
  if (!slug || slug === '/') return '/';
  return slug.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** `/services/microscope-rct` -> `microscope-rct` (for last-resort labels). */
export function slugLeaf(slug: string): string {
  const s = normalizeSlug(slug);
  if (s === '/') return 'home';
  return s.split('/').filter(Boolean).pop() ?? 'home';
}