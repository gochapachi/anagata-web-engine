// Creates the Coolify project + application for anagata-web-engine.
//
// WHY A DEDICATED PROJECT: the 'Anagata Apps' project (skcws88gk8kssco00s48og8w)
// became unreachable - GET /projects/{uuid}, PATCH, environment-create and
// application-create ALL return 404 {"message":"Project not found."} for it,
// while every other project works. It needs a Coolify restart to repair. Rather
// than disturb it further, the engine gets its own project, which is cleaner
// anyway: it is a new standalone service, not part of an existing app group.
//
// ENDPOINT CHOICE: /applications/private-deploy-key on Coolify 4.3.14 returns a
// MISLABELED 404 for every payload. Proven: switching git_repository from a full
// URL to the bare 'owner/repo' form flips the same call to a 422 complaining the
// repository "must start with https://", so the 404 masks a validation failure.
// /applications/public works, and the repo is public.
//
// Idempotent: re-running reuses an existing project/app instead of duplicating.
// Usage: COOLIFY_TOKEN=... node n8n/scripts/create-engine-app.mjs

const TOKEN = process.env.COOLIFY_TOKEN;
if (!TOKEN) {
  console.error('COOLIFY_TOKEN is required.');
  process.exit(2);
}

const BASE = 'https://server.anagataitsolutions.in/api/v1';
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const PROJECT_NAME = 'Anagata Web Engine';
const APP_NAME = 'anagata-web-engine';
const SERVER_UUID = 'u0cw0o4ckw8k8s0kwks0s880';
const DESTINATION_UUID = 'fc88g44g0okwo8gswgk88wso';

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

/* ---- 1. project (reuse if present) ------------------------------------- */

const projects = await api('/projects');
let project = Array.isArray(projects.data) ? projects.data.find((p) => p.name === PROJECT_NAME) : null;

if (project) {
  console.log(`[REUSE] project ${PROJECT_NAME} -> ${project.uuid}`);
} else {
  const created = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: PROJECT_NAME,
      description: 'Multi-tenant Next.js website + blog engine (anagata-web-engine)',
    }),
  });
  if (!created.ok) {
    console.error(`[FAIL] could not create project: HTTP ${created.status} ${JSON.stringify(created.data)}`);
    process.exit(1);
  }
  project = created.data;
  console.log(`[CREATED] project ${PROJECT_NAME} -> ${project.uuid}`);
}

// Confirm the project actually resolves before creating an app inside it. This
// is the check that would have caught the broken Anagata Apps project early.
const readBack = await api(`/projects/${project.uuid}`);
if (!readBack.ok) {
  console.error(`[FAIL] project ${project.uuid} does not resolve (HTTP ${readBack.status}). Refusing to continue.`);
  process.exit(1);
}
const envNames = (readBack.data.environments ?? []).map((e) => e.name);
console.log(`[OK] project resolves; environments: ${JSON.stringify(envNames)}`);

/* ---- 2. application ---------------------------------------------------- */

const apps = await api('/applications');
const existing = Array.isArray(apps.data) ? apps.data.find((a) => a.name === APP_NAME) : null;

if (existing) {
  console.log(`[REUSE] application ${APP_NAME} -> ${existing.uuid}`);
  console.log(`        fqdn: ${existing.fqdn} | status: ${existing.status}`);
  console.log('NEXT_UUID=' + existing.uuid);
  process.exit(0);
}

const body = {
  project_uuid: project.uuid,
  server_uuid: SERVER_UUID,
  environment_name: 'production',
  destination_uuid: DESTINATION_UUID,
  git_repository: 'https://github.com/gochapachi/anagata-web-engine',
  git_branch: 'master',
  build_pack: 'dockerfile',
  dockerfile_location: '/Dockerfile',
  ports_exposes: '3000',
  name: APP_NAME,
  description: 'Multi-tenant Next.js website + blog engine for Anagata IT Solutions',
  // Apex host for the engine. Tenant client domains go into Traefik's dynamic
  // config instead, so adding a client never restarts this container.
  domains: 'https://sites.anagataitsolutions.in',
  instant_deploy: false,
  health_check_enabled: true,
  health_check_path: '/api/health',
  health_check_port: '3000',
  is_auto_deploy_enabled: true,
};

const created = await api('/applications/public', { method: 'POST', body: JSON.stringify(body) });

if (!created.ok) {
  console.error(`[FAIL] HTTP ${created.status}: ${JSON.stringify(created.data).slice(0, 500)}`);
  process.exit(1);
}

const app = created.data;
console.log('[CREATED] application');
console.log('  uuid       :', app.uuid);
console.log('  fqdn       :', app.fqdn);
console.log('  build_pack :', app.build_pack);
console.log('  dockerfile :', app.dockerfile_location);
console.log('  git        :', app.git_repository, '@', app.git_branch);
console.log('  health     :', app.health_check_path, 'port', app.health_check_port);
console.log('');
console.log('NEXT_UUID=' + app.uuid);