// Creates the anagata-web-engine Coolify application, narrowing any validation
// error field-by-field rather than guessing.
//
// Why this exists as a script: the Coolify API returns a bare 404 for some body
// shapes and a descriptive 422 for others, so the fastest path to a working
// request is to submit a minimal body, read the validation errors, and add only
// what the API actually asks for.

const TOKEN = process.env.COOLIFY_TOKEN;
const BASE = (process.env.COOLIFY_BASE ?? 'https://server.anagataitsolutions.in').replace(/\/+$/, '') + '/api/v1';

const REQUIRED_CORE = {
  project_uuid: 'skcws88gk8kssco00s48og8w',
  server_uuid: 'u0cw0o4ckw8k8s0kwks0s880',
  environment_name: 'production',
  private_key_uuid: 'vhfl9hatgwcpzau5gvtlqeis',
  git_repository: 'https://github.com/gochapachi/anagata-web-engine',
  git_branch: 'master',
  build_pack: 'dockerfile',
};

/** Submit a body and report the status plus any field-level errors. */
async function attempt(label, body) {
  const response = await fetch(`${BASE}/applications/private-deploy-key`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (response.ok) {
    console.log(`OK    ${label}`);
    console.log(JSON.stringify(parsed, null, 2).slice(0, 1400));
    return { ok: true, data: parsed };
  }

  const errors = parsed && typeof parsed === 'object' ? parsed.errors : null;
  console.log(`FAIL  ${label} -> HTTP ${response.status}`);
  if (errors) {
    for (const [field, messages] of Object.entries(errors)) {
      console.log(`        ${field}: ${[].concat(messages).join(', ')}`);
    }
  } else {
    console.log(`        ${String(text).slice(0, 300)}`);
  }
  return { ok: false, errors, status: response.status, raw: parsed };
}

// 1. Minimal core only. Whatever it names as missing/must-be-absent is the answer.
const minimal = await attempt('minimal core', REQUIRED_CORE);

if (!minimal.ok && minimal.errors) {
  const fields = Object.keys(minimal.errors);

  // "must not be present" or an enum complaint about build_pack: try the
  // documented dockercompose pack, which is what the repo's compose file targets.
  if (fields.some((f) => /build_pack/.test(f)) || /dockerfile/i.test(JSON.stringify(minimal.errors))) {
    const asCompose = await attempt('build_pack=dockercompose', {
      ...REQUIRED_CORE,
      build_pack: 'dockercompose',
      docker_compose_location: '/docker-compose.coolify.yml',
      ports_exposes: '3000',
      domains: 'https://sites.anagataitsolutions.in',
    });
    if (asCompose.ok) process.exit(0);
  }

  // A destination is required when the server has more than one.
  if (fields.some((f) => /destination/.test(f))) {
    const withDestination = await attempt('with destination_uuid', {
      ...REQUIRED_CORE,
      destination_uuid: 'fc88g44g0okwo8gswgk88wso',
      ports_exposes: '3000',
      domains: 'https://sites.anagataitsolutions.in',
    });
    if (withDestination.ok) process.exit(0);
  }

  // environment_uuid instead of environment_name.
  if (fields.some((f) => /environment/.test(f))) {
    const withUuid = await attempt('with environment_uuid', {
      ...REQUIRED_CORE,
      environment_uuid: 'mosss8c484488ogwkksk0o0c',
      destination_uuid: 'fc88g44g0okwo8gswgk88wso',
      ports_exposes: '3000',
      domains: 'https://sites.anagataitsolutions.in',
    });
    if (withUuid.ok) process.exit(0);
  }
}

// 2. Full body, one field at a time, using everything the docs list.
const FULL = {
  ...REQUIRED_CORE,
  destination_uuid: 'fc88g44g0okwo8gswgk88wso',
  dockerfile_location: '/Dockerfile',
  ports_exposes: '3000',
  name: 'anagata-web-engine',
  description: 'Multi-tenant Next.js website + blog engine',
  domains: 'https://sites.anagataitsolutions.in',
  instant_deploy: false,
  health_check_enabled: true,
  health_check_path: '/api/health',
  health_check_port: '3000',
  is_auto_deploy_enabled: true,
  limits_memory: '1024m',
};

// Submit the full body and print exactly which field it objects to.
const full = await attempt('full body', FULL);
if (full.ok) process.exit(0);

if (full.errors) {
  // Drop whichever field it complained about and retry once - if the API wants a
  // field ABSENT (rather than fixed), removing it is the correct move.
  const bad = Object.keys(full.errors);
  const reduced = { ...FULL };
  for (const field of bad) delete reduced[field];
  console.log(`\nRetrying without: ${bad.join(', ')}`);
  const retry = await attempt('reduced body', reduced);
  if (retry.ok) process.exit(0);

  // Last resort: put back only the fields the docs mark REQUIRED.
  const strictlyRequired = {
    project_uuid: REQUIRED_CORE.project_uuid,
    server_uuid: REQUIRED_CORE.server_uuid,
    environment_name: REQUIRED_CORE.environment_name,
    private_key_uuid: REQUIRED_CORE.private_key_uuid,
    git_repository: REQUIRED_CORE.git_repository,
    git_branch: REQUIRED_CORE.git_branch,
    build_pack: REQUIRED_CORE.build_pack,
  };
  console.log('\nRetrying with strictly required fields only + dockerfile_location');
  const strict = await attempt('strict + dockerfile_location', {
    ...strictlyRequired,
    dockerfile_location: '/Dockerfile',
    ports_exposes: '3000',
    domains: 'https://sites.anagataitsolutions.in',
    name: 'anagata-web-engine',
  });
  process.exit(strict.ok ? 0 : 1);
}

process.exit(1);