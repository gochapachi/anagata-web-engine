import { NextRequest, NextResponse } from 'next/server';
import { normalizeHost, resolveInternalRewritePath, isEngineHost } from '@/lib/domain';

/**
 * Multi-tenant host router. One container serves every client domain.
 *
 * Requests for a TENANT host are internally rewritten to the private
 * `/sites/[domain]/...` segment, so the visitor's address bar keeps the client's
 * own domain while the App Router resolves the tenant from the path.
 *
 * Requests for an ENGINE host (localhost, a bare IP, the engine's own domain)
 * are passed through untouched so the operator page, `/robots.txt` and internal
 * routes resolve normally. Without this the engine's own homepage rewrites to
 * `/sites/localhost`, which is not a tenant, and 404s.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(req: NextRequest) {
  const host = normalizeHost(
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost'
  );
  const { pathname, search } = req.nextUrl;

  // Explanation: this is the engine's own multi-tenant surface, not a tenant page.
  if (pathname.startsWith('/sites')) {
    return NextResponse.next();
  }

  // First-party media proxy. Keeps every tenant's images on its own origin
  // (image SEO + no shared MinIO hostname in page source) and means a tenant
  // never has to know the storage backend exists.
  if (pathname.startsWith('/media/')) {
    const base = (process.env.MINIO_PUBLIC_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      return NextResponse.json({ error: 'MINIO_PUBLIC_URL is not configured' }, { status: 500 });
    }
    const assetPath = pathname.slice('/media/'.length);
    // On an engine host there is no tenant segment to insert.
    const tenantSegment = isEngineHost(host) ? '' : `${host}/`;
    return NextResponse.rewrite(new URL(`${base}/${tenantSegment}${assetPath}`), { status: 200 });
  }

  // API routes are tenant-aware but never rewritten; they read the host header.
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next();
    response.headers.set('x-tenant-domain', host);
    return response;
  }

  // Engine infrastructure: serve the app exactly as authored.
  if (isEngineHost(host)) {
    return NextResponse.next();
  }

  const rewritePath = resolveInternalRewritePath(host, pathname);
  const response = NextResponse.rewrite(new URL(`${rewritePath}${search}`, req.url));
  response.headers.set('x-tenant-domain', host);
  return response;
}