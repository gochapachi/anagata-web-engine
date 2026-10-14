import { getSite, getPages, getPosts } from '@/lib/supabase';

/**
 * Per-tenant sitemap. Must be a route handler rather than `sitemap.ts` because
 * the tenant domain lives in the path, and Next's metadata sitemap convention
 * cannot vary its output per path parameter.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> }
) {
  const { domain } = await params;
  const host = decodeURIComponent(domain);
  const site = await getSite(host);
  if (!site) {
    return new Response('Not found', { status: 404 });
  }

  const [pages, posts] = await Promise.all([getPages(host, site.id), getPosts(host, site.id)]);
  const base = `https://${site.domain}`;
  const now = new Date().toISOString();

  const urls = [
    ...pages.map((page) => ({
      loc: page.slug === '/' ? base : `${base}/${page.slug}`,
      priority: page.slug === '/' ? '1.0' : '0.8',
      changefreq: 'weekly',
    })),
    { loc: `${base}/blog`, priority: '0.7', changefreq: 'daily' },
    ...posts.map((post) => ({
      loc: `${base}/blog/${post.slug}`,
      priority: '0.6',
      changefreq: 'monthly',
    })),
  ];

  // Deduplicate: a `/blog` page row plus the generated index would otherwise
  // appear twice, which Search Console reports as a duplicate-URL warning.
  const seen = new Set<string>();
  const unique = urls.filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...unique.map((entry) =>
      [
        '  <url>',
        `    <loc>${entry.loc}</loc>`,
        `    <lastmod>${now}</lastmod>`,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        '  </url>',
      ].join('\n')
    ),
    '</urlset>',
  ].join('\n');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  });
}