import { getSite } from '@/lib/supabase';

/**
 * Per-tenant robots.txt. Each client gets its own file pointing at its own
 * sitemap - a shared or global robots file would either leak other tenants'
 * URLs or fail to advertise this tenant's sitemap at all.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> }
) {
  const { domain } = await params;
  const host = decodeURIComponent(domain);
  const site = await getSite(host);
  if (!site) return new Response('Not found', { status: 404 });

  const base = `https://${site.domain}`;
  const lines =
    site.status === 'live'
      ? [
          'User-agent: *',
          'Allow: /',
          'Disallow: /api/',
          '',
          `Sitemap: ${base}/sitemap.xml`,
        ]
      : [
          // A non-live tenant must never be indexed: it would create duplicate
          // content against the client's real domain.
          'User-agent: *',
          'Disallow: /',
          '',
        ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  });
}