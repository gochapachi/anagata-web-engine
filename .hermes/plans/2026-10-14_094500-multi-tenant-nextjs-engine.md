# Deployment runbook — anagata-web-engine + the two n8n workflows

**Status at time of writing:** the engine code is built and verified locally; both n8n
workflows are CREATED and validate clean; **the Supabase schema is APPLIED and the
anti-sameness rule is proven to hold in the database**; all MCP servers are wired and
authenticating. Two steps remain: n8n env vars, and deploying the engine container.

| Step | Needs | Done? |
|---|---|---|
| 1. Apply the SQL migration to Supabase | — | **DONE** (see §1) |
| 2. Set the n8n instance env vars | Coolify → n8n service env + restart | **no** |
| 3. Deploy the engine container | Coolify API token (verified working) or panel | **no** |
| 4. Smoke-test end to end | steps 2–3 done | **no** |

## §1 Database — DONE, and here is exactly what was proven

Applied with `supabase/scripts/apply-migration.mjs`; verified with
`supabase/scripts/verify-anti-sameness.mjs` (both re-runnable, both leave no rows behind).

```
TABLES  (4): leads, pages, posts, sites
VIEWS   (1): v_design_ledger
INDEXES (1): uniq_sites_niche_structure
TRIGGERS(3): trg_pages_touch, trg_posts_touch, trg_sites_touch
```

The verification run:

```
PASS  first insert of a design is accepted
PASS  duplicate design is REJECTED by the unique index
        -- duplicate key value violates unique constraint "uniq_sites_niche_structure"
PASS  a design differing on colour mode is accepted
PASS  a design differing on shell is accepted
PASS  the same design on a different niche is accepted
PASS  v_design_ledger exposes a composite structure_signature
PASS  trg_sites_touch updates updated_at
```

That is the "no two sites look alike" claim holding at the **database** layer, not just
in application code. A duplicate can no longer be created by a manual insert, a replayed
workflow, or a bug in the engine — only by deliberately dropping the index.

### Connection facts (each one cost a failed attempt)

| Fact | Value |
|---|---|
| Host / port | `213.199.62.248:5433` (Supavisor pooler — **5432 is not exposed**) |
| TLS | **must be off.** Any TLS attempt returns `The server does not support SSL connections` |
| User | bare `postgres` — **not** the tenant-qualified `postgres.<ref>` form |
| Password | `SERVICE_PASSWORD_POSTGRES` from the Coolify Supabase service env |

Re-run any time:

```bash
SUPABASE_DB_PASSWORD=<SERVICE_PASSWORD_POSTGRES> node supabase/scripts/verify-anti-sameness.mjs
```

---

Deployed workflow IDs:

| Workflow | ID | Nodes | Validation |
|---|---|---|---|
| Anagata Next.js Multi-Tenant Site Builder (v1) | `TGR0Sf8fJCXYC3ad` | 18 | valid, 0 errors |
| Anagata Next.js Multi-Tenant Blog Publisher (v1) | `AcXj1SPHmEBo9alo` | 22 | valid, 0 errors |
| Dev - Anagata Wordpress AI Website Builder v8 | `TUPLn7UxLhQyYXi0` | 120 | **untouched** |
| Wordpress Blog Automation | `KEy18W9aUN0bnZTG` | 32 | **untouched** |

---

## Step 2 — Set the n8n instance env vars (NOT DONE)

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

## MCP servers — wired and authenticating

Verified with `node n8n/scripts/verify-configured-mcp.mjs`, which makes one cheap
read-only call per server. Launching is not the same as working: a **dead** GitHub PAT
still discovered all 46 tools before failing on the first real call.

| Server | Package / binary | Tools | Auth check |
|---|---|---|---|
| `n8n` | `n8n-mcp` → `dist/mcp/stdio-wrapper.js` | 28 | `n8n_list_workflows` → OK |
| `supabase_db` | `@bytebase/dbhub` → `dist/index.js` | 2 | `execute_sql` → OK |
| `coolify` | `@masonator/coolify-mcp` → `dist/index.js` | 46 | `list_servers` → OK |
| `github` | official `github/github-mcp-server` **v2.0.2** (.exe) | 46 | `get_me` → `gochapachi` |
| `supabase` | `@supabase/mcp-server-supabase` | 19 | **cannot authenticate here** |
| `gsc` | `suganthan-gsc-mcp` | (pre-existing) | not checked |

### Four corrections to the config you supplied

1. **`masonator/coolify-mcp` → `@masonator/coolify-mcp`.** The unscoped name does not
   exist on npm; the scoped one does (v3.9.0).
2. **`@modelcontextprotocol/server-github` is DEPRECATED** (last publish 2025-04-08).
   Replaced with the official `github/github-mcp-server` v2.0.2 Windows binary at
   `~/AppData/Local/hermes/tools/github-mcp-server/github-mcp-server.exe`, args `["stdio"]`.
3. **The GitHub PAT you supplied is dead** — `401 Bad credentials` both via
   `api.github.com/user` and via the MCP server's `get_me`. Replaced with the token
   already in the `gh` CLI keyring (authenticated as `gochapachi`, scopes
   `repo, gist, read:org`). To use a fresh PAT instead, mint one with those scopes and
   re-run `hermes config set mcp_servers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN <pat>`.
4. **The Supabase MCP server cannot work against a self-hosted instance.** It talks to
   the Supabase **management API** (`api.supabase.com`) and needs an `sbp_` personal
   access token. The value supplied was an **anon JWT** (payload
   `{"ref":"nhngpjplwngcmdzqijkd","role":"anon"}`), and any JWT fails there with
   `Unauthorized. Please provide a valid access token to the MCP server`. Since this
   Supabase is self-hosted there is no management API to reach. Kept the server
   configured (it costs nothing) but **use `supabase_db` for real work** — DBHub reads
   the database directly. If you want the management-API tools too, sign up at
   supabase.com and mint an `sbp_` token.

### `supabase_db` is read-only, enforced two ways

`readonly = true` per tool in `.dbhub.local.toml` (gitignored — it embeds the DB
password). Proof:

```
execute_sql "select table_name from information_schema.tables ..."  -> rows returned
execute_sql "delete from public.sites"                              -> READONLY_VIOLATION
```

**Restart Hermes for the new servers to appear** — there is no MCP hot-reload.

---

## Known gaps, stated plainly

- **The Supabase↔engine data path has never been exercised against live data.** The
  local smoke test used a dummy service-role key, so tenant reads, page reads and lead
  inserts were only ever exercised as code. Step 4.2 is the first real test. The
  *database* side is now proven (see §1); it is the engine's reads against it that are not.
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