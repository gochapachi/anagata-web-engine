import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSite, getPosts, getPost } from '@/lib/supabase';
import { renderMdx, cssForMdxSources } from '@/components/mdx/SafeMdxRenderer';

/**
 * Tenant blog: index at /blog, article at /blog/[slug].
 *
 * Both routes read from `posts` in Supabase, which is what the upgraded n8n
 * blog workflow writes to. There is no build step between publish and live:
 * the workflow revalidates the tenant tag and the next request renders fresh.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string; slug?: string[] }>;
}): Promise<Metadata> {
  const { domain, slug } = await params;
  const host = decodeURIComponent(domain);
  const site = await getSite(host);
  if (!site) return { title: 'Not found' };

  if (!slug?.length) {
    return {
      title: `Blog | ${site.business_info?.name ?? site.domain}`,
      alternates: { canonical: `https://${site.domain}/blog` },
    };
  }

  const post = await getPost(host, site.id, slug.join('/'));
  if (!post) return { title: 'Not found' };
  const seo = post.seo_meta ?? {};
  return {
    title: seo.seo_title ?? post.title,
    description: seo.meta_description ?? post.excerpt,
    alternates: { canonical: `https://${site.domain}/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      title: seo.seo_title ?? post.title,
      description: seo.meta_description ?? post.excerpt,
      publishedTime: post.published_at,
      images: post.cover_image ? [post.cover_image] : undefined,
    },
  };
}

export default async function BlogRoute({
  params,
}: {
  params: Promise<{ domain: string; slug?: string[] }>;
}) {
  const { domain, slug } = await params;
  const host = decodeURIComponent(domain);
  const site = await getSite(host);
  if (!site) notFound();

  if (!slug?.length) {
    const posts = await getPosts(host, site.id);
    return (
      <div className="shell-section">
        <div className="shell-container">
          <span className="shell-eyebrow">Insights</span>
          <h1 className="shell-display" style={{ marginTop: '.5rem' }}>
            Blog
          </h1>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))',
              gap: '1.5rem',
              marginTop: '2.5rem',
            }}
          >
            {posts.map((post) => (
              <article
                key={post.id}
                style={{
                  border: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
                  borderRadius: 'var(--radius-card)',
                  background: 'var(--bg-surface)',
                  overflow: 'hidden',
                }}
              >
                {post.cover_image ? (
                  <img
                    src={post.cover_image}
                    alt={post.title}
                    loading="lazy"
                    width={1200}
                    height={630}
                    style={{ width: '100%', aspectRatio: '1200/630', objectFit: 'cover', display: 'block' }}
                  />
                ) : null}
                <div style={{ padding: '1.25rem' }}>
                  <span className="shell-eyebrow">{post.category}</span>
                  <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.3rem', margin: '.4rem 0' }}>
                    <Link href={`/blog/${post.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {post.title}
                    </Link>
                  </h2>
                  <p className="shell-body" style={{ margin: 0 }}>
                    {post.excerpt}
                  </p>
                  <p className="shell-eyebrow" style={{ marginTop: '.75rem' }}>
                    {post.reading_time_mins} min read
                  </p>
                </div>
              </article>
            ))}
          </div>
          {posts.length === 0 ? <p className="shell-body">No posts published yet.</p> : null}
        </div>
      </div>
    );
  }

  const post = await getPost(host, site.id, slug.join('/'));
  if (!post) notFound();

  const { element } = await renderMdx(post.content_mdx);
  const css = post.compiled_css?.trim() ? post.compiled_css : await cssForMdxSources([post.content_mdx]);
  const seo = post.seo_meta ?? {};
  const articleSchema = seo.article_schema ?? {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.published_at,
    image: post.cover_image ? [post.cover_image] : undefined,
    author: post.author?.name ? { '@type': 'Person', name: post.author.name } : undefined,
  };
  const faqSchema = seo.faq_schema ?? null;

  return (
    <article className="shell-section">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      {faqSchema ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      ) : null}
      <div className="shell-container" style={{ maxWidth: '760px' }}>
        <span className="shell-eyebrow">{post.category}</span>
        <h1 className="shell-display" style={{ marginTop: '.5rem' }}>
          {post.title}
        </h1>
        <p className="shell-body">{post.excerpt}</p>
        <p className="shell-eyebrow">
          {post.author?.name ? `By ${post.author.name} · ` : ''}
          {new Date(post.published_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })} ·{' '}
          {post.reading_time_mins} min read
        </p>
        {post.cover_image ? (
          <img
            src={post.cover_image}
            alt={post.title}
            width={1200}
            height={630}
            style={{ width: '100%', borderRadius: 'var(--radius-card)', marginBlock: '1.5rem' }}
          />
        ) : null}
        <div className="shell-body" style={{ color: 'var(--text-primary)' }}>
          {element}
        </div>
        <p style={{ marginTop: '3rem' }}>
          <Link href="/blog">← All articles</Link>
        </p>
      </div>
    </article>
  );
}