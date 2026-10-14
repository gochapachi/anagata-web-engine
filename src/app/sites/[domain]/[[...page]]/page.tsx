import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite, getPage } from '@/lib/supabase';
import { normalizeSlug } from '@/lib/domain';
import { renderMdx, cssForMdxSources } from '@/components/mdx/SafeMdxRenderer';
import type { PageRow } from '@/lib/types';

/**
 * Tenant page renderer: `/sites/[domain]` for the home page and
 * `/sites/[domain]/[page]` for everything else.
 *
 * A page row carries an ordered `sections` array. Each section is EITHER a
 * registry block (`{ block, props }`) OR AI-authored MDX (`{ mdx }`). Rendering
 * both here means one code path serves fully templated pages and fully bespoke
 * ones, and a single page can mix them.
 */

async function loadPage(domainRaw: string, slugRaw: string) {
  const host = decodeURIComponent(domainRaw);
  const site = await getSite(host);
  if (!site) return null;
  const slug = normalizeSlug(slugRaw);
  const page = await getPage(host, site.id, slug);
  return { site, page };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string; page?: string[] }>;
}): Promise<Metadata> {
  const { domain, page } = await params;
  const loaded = await loadPage(domain, (page ?? []).join('/'));
  if (!loaded?.page) return { title: 'Not found' };
  const seo = loaded.page.seo_meta ?? {};
  return {
    title: seo.title ?? loaded.page.title,
    description: seo.description,
    alternates: { canonical: `https://${loaded.site.domain}/${loaded.page.slug === '/' ? '' : loaded.page.slug}` },
    openGraph: {
      title: seo.title ?? loaded.page.title,
      description: seo.description,
      images: seo.og_image ? [seo.og_image] : undefined,
    },
  };
}

export default async function TenantPage({
  params,
}: {
  params: Promise<{ domain: string; page?: string[] }>;
}) {
  const { domain, page } = await params;
  const loaded = await loadPage(domain, (page ?? []).join('/'));
  if (!loaded?.page) notFound();
  const { site, page: row } = loaded;

  const mdxSources = row.sections.filter((section) => section.mdx).map((section) => section.mdx as string);

  // `compiled_css` is populated by the workflow's pre-flight gate. Compiling on
  // demand covers rows written before the gate existed, so a page can never
  // render unstyled.
  const css = row.compiled_css?.trim() ? row.compiled_css : await cssForMdxSources(mdxSources);

  const rendered = await Promise.all(
    row.sections.map(async (section, index) => {
      if (section.mdx) {
        const result = await renderMdx(section.mdx);
        return (
          <section key={section.anchor ?? `mdx-${index}`} id={section.anchor} className="shell-section">
            <div className="shell-container">{result.element}</div>
          </section>
        );
      }
      return null;
    })
  );

  const pageSchema = row.seo_meta?.faq_schema ?? row.seo_meta?.json_ld ?? null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {pageSchema ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }} />
      ) : null}
      <h1
        className="shell-display"
        style={{ paddingInline: 'clamp(1rem, 4vw, 2.5rem)', paddingTop: 'var(--section-gap, 5rem)', margin: 0, maxWidth: 'var(--container-width, 1280px)', marginInline: 'auto' }}
      >
        {row.title}
      </h1>
      {rendered}
      <span hidden data-site={site.slug} />
    </>
  );
}