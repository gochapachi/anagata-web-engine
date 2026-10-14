import { describe, it, expect } from 'vitest';
import {
  normalizeHost,
  resolveInternalRewritePath,
  tenantFromInternalPath,
  normalizeSlug,
  slugLeaf,
  previewSubdomainFor,
} from './domain';

describe('normalizeHost', () => {
  it('strips ports, www. and casing', () => {
    expect(normalizeHost('www.TheCrownDentalClinic.com:3000')).toBe('thecrowndentalclinic.com');
  });

  it('takes the first entry of a comma-joined forwarded host', () => {
    expect(normalizeHost('a.com, b.com')).toBe('a.com');
  });

  it('falls back to localhost for empty input', () => {
    expect(normalizeHost(null)).toBe('localhost');
    expect(normalizeHost('')).toBe('localhost');
  });

  it('preserves preview subdomains', () => {
    expect(normalizeHost('crown-dental.sites.anagataitsolutions.in')).toBe(
      'crown-dental.sites.anagataitsolutions.in'
    );
  });
});

describe('resolveInternalRewritePath', () => {
  it('maps the root path with no trailing slash', () => {
    expect(resolveInternalRewritePath('thecrowndentalclinic.com', '/')).toBe(
      '/_sites/thecrowndentalclinic.com'
    );
  });

  it('maps nested paths verbatim', () => {
    expect(resolveInternalRewritePath('thecrowndentalclinic.com', '/blog/rct-cost')).toBe(
      '/_sites/thecrowndentalclinic.com/blog/rct-cost'
    );
  });

  it('normalizes a host that still carries www. or a port', () => {
    expect(resolveInternalRewritePath('www.x.com:8080', '/about')).toBe('/_sites/x.com/about');
  });
});

describe('tenantFromInternalPath', () => {
  it('round-trips a rewritten path', () => {
    const original = '/blog/hello';
    const rewritten = resolveInternalRewritePath('x.com', original);
    expect(tenantFromInternalPath(rewritten)).toEqual({ host: 'x.com', rest: original });
  });

  it('returns null for non-tenant paths', () => {
    expect(tenantFromInternalPath('/api/leads')).toBeNull();
  });
});

describe('normalizeSlug / slugLeaf / previewSubdomainFor', () => {
  it('keeps root as root and strips surrounding slashes', () => {
    expect(normalizeSlug('/')).toBe('/');
    expect(normalizeSlug('/about/')).toBe('about');
    expect(normalizeSlug('services/x')).toBe('services/x');
  });

  it('derives a label from the last segment', () => {
    expect(slugLeaf('/')).toBe('home');
    expect(slugLeaf('services/microscope-rct')).toBe('microscope-rct');
  });

  it('builds the preview subdomain', () => {
    expect(previewSubdomainFor('crown-dental')).toBe('crown-dental.sites.anagataitsolutions.in');
  });
});