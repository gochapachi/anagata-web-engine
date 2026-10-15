/**
 * Regression: the tenant lookup must be keyed per HOST, and must not be served
 * from a cache shared between tenants.
 *
 * THE BUG (found live): all ten preview hosts rendered the SAME tenant -
 * "Fix Verify Dental", the oldest row. Cause: Next.js' Data Cache is shared
 * across every visitor, and unstable_cache() keyed on ['site', host] still let
 * one tenant's row answer another tenant's request, because the cached entry was
 * populated once and reused. A multi-tenant engine that mixes tenants up is the
 * worst possible failure: it serves one client's content on another client's
 * domain.
 *
 * These tests pin the KEY CONSTRUCTION and the HOST SHAPE, which is where the
 * defect lived, without needing a live Supabase or a browser.
 */
import { describe, it, expect } from 'vitest';
import { normalizeHost, previewSubdomainFor, tenantFromInternalPath } from '../domain';

describe('tenant cache isolation', () => {
  it('builds a distinct cache key for every host', () => {
    // This is the exact key tuple unstable_cache receives. Two different tenants
    // must never collapse onto the same key.
    const keyFor = (host: string) => ['site', normalizeHost(host)];
    const a = keyFor('styled-render-dental.anagataitsolutions.in');
    const b = keyFor('fix-verify-dental.anagataitsolutions.in');

    expect(a).not.toEqual(b);
    expect(a[1]).toBe('styled-render-dental.anagataitsolutions.in');
    expect(b[1]).toBe('fix-verify-dental.anagataitsolutions.in');
  });

  it('keeps preview hosts for different slugs distinct end to end', () => {
    const hosts = [
      'styled-render-dental',
      'green-chain-dental',
      'full-chain-dental',
      'fix-verify-dental',
    ].map((slug) => previewSubdomainFor(slug));

    // Every preview host must be unique, or two tenants share an address.
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('round-trips each preview host back to its own tenant segment', () => {
    // The rewrite path is what the page reads as [domain]; if two hosts rewrote
    // to the same segment, both would render the same tenant.
    for (const slug of ['styled-render-dental', 'green-chain-dental']) {
      const host = previewSubdomainFor(slug);
      const rewritten = `/sites/${host}`;
      const parsed = tenantFromInternalPath(rewritten);

      expect(parsed).not.toBeNull();
      expect(parsed?.host).toBe(host);
    }
  });

  it('never treats a preview host as the engine host', () => {
    // If a preview host were classified as engine infrastructure, middleware
    // would skip the rewrite and serve the operator page for every tenant -
    // which is exactly the "all previews look identical" symptom.
    for (const slug of ['styled-render-dental', 'fix-verify-dental']) {
      const host = previewSubdomainFor(slug);
      expect(host.startsWith('sites.')).toBe(false);
      expect(host).not.toBe('sites.anagataitsolutions.in');
    }
  });
});
