# Deployment runbook — anagata-web-engine + the two n8n workflows

**Status at time of writing:** the engine code is built and verified locally; both n8n
workflows are CREATED and validate clean. Three steps remain, all of which need
credentials this session did not have. Do them in order — the workflows fail on their
first write until step 1 is done.

| Step | Needs | Done? |
|---|---|---|
| 1. Apply the SQL migration to Supabase | Supabase Studio access or DB password | **no** |
| 2. Set the n8n instance env vars | Coolify → n8n service env + restart | **no** |
| 3. Deploy the engine container | Coolify API token or panel access | **no** |
| 4. Smoke-test end to end | steps 1–3 done | **no** |

Deployed workflow IDs:

| Workflow | ID | Nodes | Validation |
|---|---|---|---|
| Anagata Next.js Multi-Tenant Site Builder (v1) | `TGR0Sf8fJCXYC3ad` | 18 | valid, 0 errors |
| Anagata Next.js Multi-Tenant Blog Publisher (v1) | `AcXj1SPHmEBo9alo` | 22 | valid, 0 errors |
| Dev - Anagata Wordpress AI Website Builder v8 | `TUPLn7UxLhQyYXi0` | 120 | **untouched** |
| Wordpress Blog Automation | `KEy18W9aUN0bnZTG` | 32 | **untouched** |

---

## Step 1 — Apply the SQL migration

The schema file is `supabase/migrations/001_multi_tenant_schema.sql` in this repo.
Either paste the whole file into Supabase Studio → SQL Editor → New query → Run, or
run it over SSH:

```bash
ssh root@213.199.62.248
# locate the Supabase db container
docker ps --format '{{.Names}}' | grep supabase-db
# copy the file over first (from your machine):
#   scp supabase/migrations/001_multi_tenant_schema.sql root@213.199.62.248:/tmp/
docker exec -i <supabase-db-container> psql -U postgres -d postgres < /tmp/001_multi_tenant_schema.sql
```

Verify — expect `4` tables, `1` view, `1` index:

```sql
select count(*) as tables from information_schema.tables
  where table_schema='public' and table_name in ('sites','pages','posts','leads');
select count(*) as views from information_schema.views
  where table_schema='public' and table_name='v_design_ledger';
select count(*) as design_index from pg_indexes
  where schemaname='public' and indexname='uniq_sites_niche_structure';
```

Note: the unique index on (niche, shell, nav, colour) is the database-level
anti-sameness backstop. If you ever need two identical layouts on purpose, drop it
deliberately rather than working around it.

## Step 2 — Set the n8n instance env vars

The two workflows read config through `$env.*`. In Coolify → the n8n service →
Environment Variables, add:

```
ENGINE_URL=https://sites.anagataitsolutions.in
SUPABASE_URL=https://supabase.anagataitsolutions.in
SUPABASE_SERVICE_ROLE_KEY=<the service_role key>
ENGINE_REVALIDATE_SECRET=<openssl rand -hex 32>
ENGINE_COMPILE_SECRET=<the same value you give the engine, or omit>
SITES_BASE_DOMAIN=sites.anagataitsolutions.in
N8N_WEBHOOK_BASE=https://n8n.anagataitsolutions.in/webhook
```

`SUPABASE_SERVICE_ROLE_KEY` is available in Supabase Studio → Settings → API, or in
the Coolify service `.env` as `SERVICE_SUPABASESERVICE_KEY`.

**Restart the n8n container after saving** — `$env` is read at process start.

Alternative if you cannot restart: replace each `={{ $env.X }}` with the literal value
in `n8n/scripts/build-workflows.mjs`, regenerate, and re-run the deploy script. That
puts the Supabase key inside the workflow definition, which is why it is the fallback
and not the default.

## Step 3 — Deploy the engine

In Coolify, create a new **Docker Compose** resource from
`docker-compose.coolify.yml` (or a **Dockerfile** resource from `Dockerfile`), pointing
at this repo. Set the same env vars as step 2, plus `MINIO_PUBLIC_URL`.

Health check after deploy — expect HTTP 200 and `"status":"ok"`:

```bash
curl -s https://sites.anagataitsolutions.in/api/health
```

Then point the fleet at it. For each tenant domain add a router to
`/data/coolify/proxy/dynamic/anagata-tenants.yaml` on the VPS (see the header comment
in `docker-compose.coolify.yml` for the exact snippet). Traefik watches that directory
and provisions the certificate with **no container restart** — do not add tenant FQDNs
through the Coolify API, which rewrites `fqdn` and restarts the container, taking every
other tenant down for a few seconds.

## Step 4 — Smoke test

1. `curl -s https://sites.anagataitsolutions.in/api/genome` — should list the 5 shells,
   8 navs, 12 colour modes, 8 rhythms and the limits block.
2. Trigger the site builder with a throwaway business:
   ```bash
   curl -s -X POST https://n8n.anagataitsolutions.in/webhook/nextjs-site-generator-v1 \
     -H 'Content-Type: application/json' \
     -d '{"business_name":"Smoke Test Dental","niche":"dental-clinic","city":"Pune",
          "phone":"+919999999999","services":["Root Canal","Dental Implants"]}'
   ```
   Expect a JSON response with `status: "created"`, `pages_generated: 5` and a
   `design.shell` value. Then open the returned `preview_url`.
3. Trigger the blog publisher:
   ```bash
   curl -s -X POST https://n8n.anagataitsolutions.in/webhook/nextjs-blog-publisher-v1 \
     -H 'Content-Type: application/json' \
     -d '{"domain":"smoke-test-dental.sites.anagataitsolutions.in","count":1}'
   ```
4. Confirm the anti-sameness behaviour by running step 2 twice with different business
   names and checking that `design.shell` DIFFERS between the two responses.

---

## Known gaps, stated plainly

- **The Supabase↔engine data path has never been exercised against live data.** The
  local smoke test used a dummy service-role key, so tenant reads, page reads and lead
  inserts were only ever exercised as code. Step 4.2 is the first real test.
- **Lead notification is not wired.** The `pg_net` trigger in the migration is
  commented out; leads land in the `leads` table and nothing pushes them to WhatsApp
  yet. Uncomment it and set `app.lead_webhook_secret` once you want that.
- **Neither workflow is activated.** Both were created inactive on purpose so nothing
  fires before the schema exists. Activate after step 4 passes.
- **The plan markdown was never written** to `.hermes/plans/`; the planning turns
  delivered it inline because file tools were detached at that moment.
- **`n8n/scripts/deploy-new-workflows.mjs` updates by name.** It refuses to touch any
  workflow id in its protected list, but if you rename one of the two new workflows in
  the n8n UI, the next run will create a duplicate instead of updating.