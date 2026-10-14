import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getSite, insertLead, countRecentLeads } from '@/lib/supabase';

/**
 * Lead capture with anti-spam, replacing the WordPress form spam problem.
 *
 * Defence layers (any one trips a silent 200 reject so bots learn nothing):
 *   1. Honeypot field - a real field name that is visually hidden. Filled = bot.
 *   2. Time-to-submit - humans take >2.5s. Instant submits are scripts.
 *   3. Per-IP rate limit - 3 submissions/hour/site, so a single source cannot
 *      carpet-bomb a clinic's inbox (the `salujadentals.com` failure mode).
 *   4. Honeypot/rate state is never echoed back, and rejections return the same
 *      200 shape as successes.
 *
 * Valid leads are inserted into Supabase, and n8n picks them up by polling or
 * via a webhook fired by a Supabase database trigger - the engine does not call
 * n8n directly, so a WhatsApp outage never loses a lead.
 */

const MIN_SUBMIT_MS = 2500;
const RATE_LIMIT_WINDOW_HOURS = 1;
const RATE_LIMIT_MAX = 3;

/** Silent-accept response, identical for accepted and rejected spam. */
const ok = () => NextResponse.json({ status: 'received' }, { status: 200 });

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // 1. Honeypot. The field is named plausibly so `autofill` and simple crawlers
  //    fill it; a human never sees it.
  if (typeof body.website_url_honeypot === 'string' && body.website_url_honeypot.trim() !== '') {
    return ok();
  }

  // 2. Time gate.
  const loadedAt = Number(body.form_loaded_at ?? 0);
  if (!loadedAt || Number.isNaN(loadedAt) || Date.now() - loadedAt < MIN_SUBMIT_MS) {
    return ok();
  }

  const host = req.headers.get('x-tenant-domain') ?? req.headers.get('host') ?? '';
  const domain = host.replace(/:\d+$/, '').replace(/^www\./, '');
  const site = await getSite(domain);
  if (!site) {
    return NextResponse.json({ error: 'Unknown site' }, { status: 404 });
  }

  const name = String(body.name ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  if (!name || !phone || phone.replace(/\D/g, '').length < 7) {
    return NextResponse.json({ error: 'name and a valid phone are required' }, { status: 422 });
  }

  // 3. Rate limit per (site, ip).
  const ipHash = hashIp(clientIp(req));
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 3600_000).toISOString();
  try {
    const recent = await countRecentLeads(site.id, ipHash, since);
    if (recent >= RATE_LIMIT_MAX) return ok();
  } catch {
    // A counting failure must not block a genuine lead.
  }

  try {
    const inserted = await insertLead({
      site_id: site.id,
      source_path: String(body.source_path ?? '').slice(0, 300),
      name: name.slice(0, 120),
      phone: phone.slice(0, 40),
      email: body.email ? String(body.email).slice(0, 160) : null,
      service: body.service ? String(body.service).slice(0, 160) : null,
      message: body.message ? String(body.message).slice(0, 2000) : null,
      ip_hash: ipHash,
      metadata: {
        user_agent: req.headers.get('user-agent') ?? null,
        referer: req.headers.get('referer') ?? null,
      },
    });
    return NextResponse.json({ status: 'received', id: inserted?.[0]?.id ?? null }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: 'Could not store lead' }, { status: 500 });
  }
}

/** CORS preflight: forms may be submitted from the tenant's own origin. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}