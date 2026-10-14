import { NextResponse } from 'next/server';
import { FLEET_CAPACITY, PAIR_WINDOW, SIMILARITY_LIMIT, PROVEN_WORST_CASE } from '@/lib/genome';

/**
 * Liveness + configuration health. Used by Coolify's healthcheck and by the n8n
 * workflows before they start a long generation run - a misconfigured engine
 * should fail fast at the first call, not after twenty minutes of LLM spend.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENGINE_REVALIDATE_SECRET'];
  const optional = ['MINIO_PUBLIC_URL', 'ENGINE_COMPILE_SECRET', 'SITES_BASE_DOMAIN'];

  const missing = required.filter((name) => !process.env[name]);
  const absentOptional = optional.filter((name) => !process.env[name]);

  return NextResponse.json(
    {
      status: missing.length === 0 ? 'ok' : 'degraded',
      uptime_seconds: Math.round(process.uptime()),
      missing_required_env: missing,
      missing_optional_env: absentOptional,
      anti_sameness: {
        fleet_capacity: FLEET_CAPACITY,
        pair_window: PAIR_WINDOW,
        similarity_limit: SIMILARITY_LIMIT,
        proven_worst_case: PROVEN_WORST_CASE,
      },
      features: {
        multi_tenant_middleware: true,
        runtime_tailwind: true,
        mdx_validation_gate: true,
        per_tenant_sitemap: true,
        anti_spam_leads: true,
      },
    },
    { status: missing.length === 0 ? 200 : 503 }
  );
}