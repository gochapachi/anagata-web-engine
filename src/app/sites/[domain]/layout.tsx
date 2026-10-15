import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite, getPages } from '@/lib/supabase';
import { pickGenome } from '@/lib/genome';
import { googleFontsHref, effectiveNavTopology } from '@/components/shells/types';
import { SHELLS } from '@/components/shells';
import { SmoothScroll } from '@/components/motion/three-d';
import type { DesignGenome, SiteRow } from '@/lib/types';

// The shell primitives (.shell-container, .shell-section, .shell-display, ...) MUST
// be loaded from a module that is actually in the render path.
//
// They used to arrive only via `NavBar.tsx`'s `import './shell.css'`, and nothing
// imported NavBar - so 234 lines / 28 selectors of shell CSS were never bundled.
// The build emitted NO CSS at all (.next/static/css did not exist), which left
// every tenant page unstyled: a 16px browser-default H1, no container width, no
// section spacing, overlapping sections. Importing the stylesheet here fixes it
// for every tenant route because all of them render through this layout.
import '@/components/shells/shell.css';

/**
 * Tenant layout. Resolves the host to a tenant, derives (or restores) its design
 * genome, and wraps children in the matching structural shell.
 *
 * Genome source of truth is `sites.design_genome` in Supabase. If a tenant row
 * predates the genome column or has an incomplete one, the genome is
 * deterministically re-derived from the tenant's own seed - never randomly, so
 * the same site renders identically on every request and every pod.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string }>;
}): Promise<Metadata> {
  const { domain } = await params;
  const site = await getSite(decodeURIComponent(domain));
  if (!site) return { title: 'Not found' };

  const seo = site.seo_global ?? {};
  // Canonical must use the host the visitor actually arrived on. site.domain is
  // the CLIENT's future production domain; when it is still a placeholder (or a
  // .example.com demo), pointing canonicals at it sends every search signal to
  // a host that does not exist. The request host is always the real one.
  const requestHost = decodeURIComponent(domain);
  const isPlaceholder = /example\.(com|org|net)$|\bexample\b/i.test(requestHost) || requestHost.endsWith('.example.com');
  const canonicalHost = isPlaceholder ? requestHost : site.domain || requestHost;
  const canonical = `https://${canonicalHost}`;

  return {
    metadataBase: new URL(`https://${requestHost}`),
    title: seo.title_template ? { template: seo.title_template, default: seo.default_title ?? site.business_info?.name } : (seo.default_title ?? site.business_info?.name ?? site.domain),
    // A tenant page with no description is invisible in SERPs. Derive one from
    // the business facts when the sitemap agent did not supply one.
    description:
      seo.description ??
      ([site.business_info?.name, site.niche, 'in', site.city]
        .filter(Boolean)
        .join(' ') || site.domain),
    alternates: { canonical },
    openGraph: {
      type: 'website',
      url: canonical,
      siteName: site.business_info?.name ?? site.domain,
      images: seo.og_image ? [seo.og_image] : undefined,
    },
    // Preview tenants are noindex; live ones are indexable.
    robots: { index: site.status === 'live', follow: site.status === 'live' },
  };
}

/** Resolves or reconstructs the tenant genome. */
export async function resolveGenome(site: SiteRow): Promise<DesignGenome> {
  const stored = site.design_genome as DesignGenome | undefined;
  if (stored?.shell_archetype && stored.tokens && stored.fonts) return stored;
  return pickGenome({ seed: site.slug || site.domain, niche: site.niche, city: site.city });
}

export async function defaultNav(site: SiteRow) {
  const pages = await getPages(site.domain, site.id);
  // The authoritative set of page slugs that actually exist. Nav entries whose
  // target page was never written (an interrupted run, a salvaged page) are
  // dropped here rather than shipped as a primary CTA 404. The site row's nav
  // is authored from the sitemap plan before the pages exist, so it can
  // legitimately point at slugs that never landed.
  const existing = new Set(pages.map((page) => page.slug));
  existing.add('');

  // '/about#team' -> 'about'; '/about' -> 'about'; '/' -> ''
  const targetOf = (href: string) =>
    String(href)
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/[#?].*$/, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');

  const reachable = (item: { href?: string }) => existing.has(targetOf(item.href ?? '/'));

  const fromConfig = Array.isArray(site.navigation?.items) ? site.navigation.items : null;
  if (fromConfig?.length) {
    const filtered = fromConfig.map((item: any) => ({
      label: String(item.label ?? item.title ?? ''),
      href: String(item.href ?? item.url ?? '/'),
    })).filter(reachable);
    // If filtering emptied the nav entirely, fall through to the page-derived
    // default rather than rendering an empty header.
    if (filtered.length) return filtered;
  }

  return pages
    .filter((page) => ['/', 'about', 'services', 'blog', 'contact'].includes(page.slug))
    .map((page) => ({
      label: page.slug === '/' ? 'Home' : page.title,
      href: page.slug === '/' ? '/' : `/${page.slug}`,
    }));
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const host = decodeURIComponent(domain);
  const site = await getSite(host);
  if (!site) notFound();

  const genome = await resolveGenome(site);
  const nav = await defaultNav(site);
  const Shell = SHELLS[genome.shell_archetype as keyof typeof SHELLS];
  if (!Shell) notFound();
  const topology = effectiveNavTopology(genome.shell_archetype, genome.nav_topology);

  const business = site.business_info ?? {};
  const cta = business.cta ?? (business.phone ? { label: 'Book appointment', href: `tel:${business.phone}` } : null);

  // Declarations are injected as a raw <style> tag. `dangerouslySetInnerHTML`
  // is safe here because the values come from PALETTES (constants), not user
  // input - the workflow can only choose an enum, never inject CSS.
  const cssDecls = Object.entries(genome.tokens)
    .map(([name, value]) => `${name}:${value};`)
    .join('');
  const fontDecls = `--font-heading:'${genome.fonts.heading}',serif;--font-body:'${genome.fonts.body}',sans-serif;`;

  const jsonLd = site.seo_global?.json_ld ?? (business.name
    ? {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: business.name,
        telephone: business.phone,
        address: business.address,
        url: `https://${site.domain}`,
      }
    : null);

  return (
    <>
      {/* Hoisted into <head> by React 19 from anywhere in the tree, so the
          tenant layout can own them without nesting a second <html>. */}
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={googleFontsHref(genome)} />
      <style dangerouslySetInnerHTML={{ __html: `:root{${cssDecls}${fontDecls}}` }} />
      {jsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      ) : null}
      <div className={`nav-${topology}`}>
        {/* SmoothScroll is a client component; the Shell and its children stay
            server-rendered and pass through the display:contents wrapper. Lenis
            eases native scroll site-wide and stays in lock-step with GSAP's
            ScrollTrigger, so pinned scenes (StickyScene) don't jitter. Reduced
            motion keeps native scroll. */}
        <SmoothScroll>
          <Shell
            site={site}
            genome={genome}
            nav={nav}
            brandName={business.name ?? site.domain}
            cta={cta}
            phone={business.phone}
            footer={buildFooter(site, nav)}
          >
            {children}
          </Shell>
        </SmoothScroll>
      </div>
    </>
  );
}

function buildFooter(site: SiteRow, nav: { label: string; href: string }[]) {
  const business = site.business_info ?? {};
  const columns = [
    { title: 'Explore', links: nav.slice(0, 5) },
    { title: 'Contact', links: [
      ...(business.phone ? [{ label: business.phone, href: `tel:${business.phone}` }] : []),
      ...(business.email ? [{ label: business.email, href: `mailto:${business.email}` }] : []),
    ] },
  ];
  if (business.address) {
    columns.push({ title: 'Visit', links: [{ label: business.address, href: `https://maps.google.com/?q=${encodeURIComponent(business.address)}` }] });
  }
  return columns.filter((column) => column.links.length > 0);
}