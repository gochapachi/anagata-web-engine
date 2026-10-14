-- ============================================================================
-- anagata-web-engine: multi-tenant schema
--
-- Apply against the Coolify Supabase instance (service pcw4oo0oo84cokggcocwko84,
-- database `postgres`) in the Supabase SQL editor or with psql.
--
-- Four tables: sites (tenants), pages (layouts), posts (blog), leads (enquiries).
-- Every tenant-scoped table carries site_id and is indexed on it: the engine
-- always filters by site_id, never by slug alone.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. sites - the tenant registry and the anti-sameness ledger.
--
-- `design_genome` is the whole visual identity of the tenant. Its
-- (shell_archetype, nav_topology, color_mode) triple is UNIQUE across the fleet
-- via the view below, which is what stops two clients looking alike.
-- ----------------------------------------------------------------------------
create table if not exists public.sites (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  domain            text not null unique,
  preview_subdomain text not null unique,
  niche             text not null default 'professional-services',
  city              text not null default '',
  business_info     jsonb not null default '{}'::jsonb,
  design_genome     jsonb not null default '{}'::jsonb,
  navigation        jsonb not null default '{}'::jsonb,
  seo_global        jsonb not null default '{}'::jsonb,
  status            text not null default 'preview'
                    check (status in ('draft', 'preview', 'live', 'suspended')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_sites_domain on public.sites (domain);
create index if not exists idx_sites_preview on public.sites (preview_subdomain);
create index if not exists idx_sites_niche_created on public.sites (niche, created_at desc);
-- The single most important index for the engine's core promise: the workflow
-- reads this to check whether a design combination is already in use.
create index if not exists idx_sites_genome_shell
  on public.sites ((design_genome->>'shell_archetype'));
create index if not exists idx_sites_genome_nav
  on public.sites ((design_genome->>'nav_topology'));
create index if not exists idx_sites_genome_color
  on public.sites ((design_genome->>'color_mode'));
create index if not exists idx_sites_genome_heading
  on public.sites ((design_genome->'fonts'->>'heading'));

-- ----------------------------------------------------------------------------
-- 2. pages - one row per page per tenant.
--
-- `compiled_css` is written by the engine's /api/compile gate: Tailwind v4 CSS
-- for every arbitrary utility the AI authored in `sections`. Without it those
-- classes would never exist in the build and the page would render unstyled.
-- ----------------------------------------------------------------------------
create table if not exists public.pages (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.sites(id) on delete cascade,
  slug         text not null,               -- '/' for home, 'about', 'services/x'
  title        text not null,
  seo_meta     jsonb not null default '{}'::jsonb,
  sections     jsonb not null default '[]'::jsonb,
  compiled_css text not null default '',
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (site_id, slug)
);

create index if not exists idx_pages_site_slug on public.pages (site_id, slug)
  where published;
create index if not exists idx_pages_site on public.pages (site_id);

-- ----------------------------------------------------------------------------
-- 3. posts - the blog. Written by the blog-publisher workflow.
-- ----------------------------------------------------------------------------
create table if not exists public.posts (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references public.sites(id) on delete cascade,
  slug              text not null,
  title             text not null,
  excerpt           text not null default '',
  content_mdx       text not null,
  compiled_css      text not null default '',
  cover_image       text,
  category          text not null default 'General',
  tags              text[] not null default '{}',
  author            jsonb not null default '{}'::jsonb,
  seo_meta          jsonb not null default '{}'::jsonb,
  reading_time_mins int not null default 5,
  status            text not null default 'published'
                    check (status in ('draft', 'published')),
  published_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (site_id, slug)
);

create index if not exists idx_posts_site_published
  on public.posts (site_id, status, published_at desc);
create index if not exists idx_posts_site_slug on public.posts (site_id, slug);
create index if not exists idx_posts_tags on public.posts using gin (tags);

-- ----------------------------------------------------------------------------
-- 4. leads - anti-spam protected enquiries.
--
-- `ip_hash` is a truncated SHA-256 of the client IP, never the IP itself, so the
-- table can rate-limit without storing personal data. Indexed with created_at so
-- the per-hour count is an index-only scan.
-- ----------------------------------------------------------------------------
create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.sites(id) on delete cascade,
  source_path text not null default '',
  name        text not null,
  phone       text not null,
  email       text,
  service     text,
  message     text,
  ip_hash     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_leads_rate_limit
  on public.leads (site_id, ip_hash, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. Design ledger view - what the workflow reads before generating a site.
--
-- Returns the last 200 tenants with their structural axes flattened, so the
-- workflow can build an accurate ban list without parsing nested JSON in n8n.
-- ----------------------------------------------------------------------------
create or replace view public.v_design_ledger as
select
  s.id,
  s.slug,
  s.domain,
  s.niche,
  s.city,
  s.created_at,
  s.design_genome->>'shell_archetype' as shell_archetype,
  s.design_genome->>'nav_topology'    as nav_topology,
  s.design_genome->>'color_mode'      as color_mode,
  s.design_genome->>'spacing_scale'   as spacing_scale,
  s.design_genome->>'motion_profile'  as motion_profile,
  s.design_genome->'fonts'->>'heading' as heading_font,
  s.design_genome->'fonts'->>'body'    as body_font,
  concat_ws('|',
    s.design_genome->>'shell_archetype',
    s.design_genome->>'nav_topology',
    s.design_genome->>'color_mode',
    coalesce(s.design_genome->>'_rhythm', 'divided-columns')
  ) as structure_signature
from public.sites s
order by s.created_at desc
limit 200;

-- ----------------------------------------------------------------------------
-- 6. Duplicate-design guard.
--
-- The engine refuses duplicates in application code, but a direct DB write (a
-- manual insert, a replayed workflow) could still create one. This index makes
-- a repeated (shell, nav, colour) triple on the SAME niche impossible at the
-- database level, which is the actual anti-sameness backstop.
-- ----------------------------------------------------------------------------
create unique index if not exists uniq_sites_niche_structure
  on public.sites (
    niche,
    (design_genome->>'shell_archetype'),
    (design_genome->>'nav_topology'),
    (design_genome->>'color_mode')
  )
  where status <> 'suspended';

-- ----------------------------------------------------------------------------
-- 7. updated_at maintenance.
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sites_touch on public.sites;
create trigger trg_sites_touch before update on public.sites
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_pages_touch on public.pages;
create trigger trg_pages_touch before update on public.pages
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_posts_touch on public.posts;
create trigger trg_posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 8. Lead notification.
--
-- Fires the n8n blog/lead webhook asynchronously. Kept as a trigger (not an
-- engine-side HTTP call) so a WhatsApp outage can never fail a form submission
-- or lose a lead: the row is already committed before n8n is told.
--
-- Replace the URL and secret, then uncomment when the webhook workflow exists.
-- ----------------------------------------------------------------------------
-- create extension if not exists pg_net;
-- create or replace function public.notify_lead() returns trigger language plpgsql as $$
-- begin
--   perform net.http_post(
--     url     := 'https://n8n.anagataitsolutions.in/webhook/nextjs-lead-notify-v1',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--                                   'x-webhook-secret', current_setting('app.lead_webhook_secret', true)),
--     body    := jsonb_build_object('lead_id', new.id, 'site_id', new.site_id,
--                                   'name', new.name, 'phone', new.phone,
--                                   'service', new.service, 'source_path', new.source_path)
--   );
--   return new;
-- end;
-- $$;
-- create trigger trg_leads_notify after insert on public.leads
--   for each row execute function public.notify_lead();

-- ----------------------------------------------------------------------------
-- 9. Verification. Expect: 4 tables, 1 view, 1 unique index.
-- ----------------------------------------------------------------------------
-- select count(*) as tables from information_schema.tables
--   where table_schema = 'public' and table_name in ('sites','pages','posts','leads');
-- select count(*) as views from information_schema.views
--   where table_schema = 'public' and table_name = 'v_design_ledger';
-- select count(*) as design_index from pg_indexes
--   where schemaname = 'public' and indexname = 'uniq_sites_niche_structure';