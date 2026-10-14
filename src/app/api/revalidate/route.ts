import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag, revalidatePath } from 'next/cache';
import { siteTag, postTag } from '@/lib/supabase';

/**
 * On-demand cache invalidation, called by both n8n workflows after a write.
 *
 * Scoped per tenant: revalidating `site:<domain>` refreshes one client's pages
 * without touching the other tenants sharing this container.
 *
 * Auth is a shared secret header. Unauthenticated, this endpoint would let
 * anyone flush cache for any tenant, so it fails closed when the secret is not
 * configured at all.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.ENGINE_REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'ENGINE_REVALIDATE_SECRET is not configured' }, { status: 500 });
  }

  const provided =
    req.headers.get('x-revalidate-secret') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');

  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { domain?: string; slug?: string; type?: 'site' | 'post' | 'page' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { domain, slug, type = 'site' } = body;
  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }

  const invalidated: string[] = [];

  revalidateTag(siteTag(domain));
  invalidated.push(siteTag(domain));

  if (type === 'post' && slug) {
    revalidateTag(postTag(domain, slug));
    invalidated.push(postTag(domain, slug));
    revalidatePath(`/_sites/${domain}/blog/${slug}`);
    revalidatePath(`/_sites/${domain}/blog`);
    invalidated.push(`/_sites/${domain}/blog/${slug}`, `/_sites/${domain}/blog`);
  }

  // Pages and the sitemap are always refreshed: a new post changes the sitemap,
  // and a page edit must not require a second call.
  revalidatePath(`/_sites/${domain}`, 'layout');
  invalidated.push(`/_sites/${domain}`);

  return NextResponse.json({ revalidated: true, domain, type, slug: slug ?? null, invalidated });
}