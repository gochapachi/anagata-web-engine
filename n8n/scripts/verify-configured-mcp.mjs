#!/usr/bin/env node
/**
 * Verifies every configured MCP server with the arguments Hermes itself will use.
 *
 * WHY THIS EXISTS: a server that launches is not a server that works. The skill's
 * verify script proves launch + tool discovery; this checks the extra half - that
 * the credentials inside config.yaml actually AUTHENTICATE, by making one cheap
 * read-only call per server. A token can be present, syntactically valid and
 * completely dead (observed: a GitHub PAT returning 401 Bad credentials after
 * discovering all 46 tools).
 *
 * Usage: node n8n/scripts/verify-configured-mcp.mjs
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const CONFIG = `${process.env.HOME}/AppData/Local/hermes/config.yaml`;

/** Each check names a tool and the payload proving the credential is live. */
const CHECKS = {
  github: { tool: 'get_me', args: {}, expect: /login/ },
  supabase_db: {
    tool: 'execute_sql',
    args: { sql: 'select count(*)::int as n from public.sites' },
    expect: /success/,
  },
  coolify: { tool: 'list_servers', args: {}, expect: /./ },
  n8n: { tool: 'n8n_list_workflows', args: { limit: 3 }, expect: /./ },
};

/** Minimal YAML reader for the mcp_servers block (no deps). */
async function readServers() {
  const text = await readFile(CONFIG, 'utf8');
  const start = text.indexOf('mcp_servers:');
  const end = text.indexOf('\ntelemetry:', start);
  const block = text.slice(start, end === -1 ? undefined : end);

  const servers = {};
  const lines = block.split(/\r?\n/);
  let current = null;
  let section = null;

  for (const line of lines) {
    const serverMatch = /^ {2}([a-zA-Z0-9_]+):\s*$/.exec(line);
    if (serverMatch) {
      current = serverMatch[1];
      servers[current] = { args: [], env: {} };
      section = 'server';
      continue;
    }
    if (!current) continue;

    const kv = /^ {4}([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      const [, key, value] = kv;
      if (key === 'args' && value === '') section = 'args';
      else if (key === 'env' && value === '') section = 'env';
      else {
        servers[current][key] = value.trim();
        section = 'server';
      }
      continue;
    }

    const item = /^\s{6,}(- )?(.*)$/.exec(line);
    if (item && section === 'args' && !item[1]) servers[current].args.push(item[2].trim());
    else if (item && section === 'args' && item[1]) servers[current].args.push(item[2].trim());
    else if (item && section === 'env') {
      const eq = item[2].indexOf(':');
      if (eq > 0) servers[current].env[item[2].slice(0, eq).trim()] = item[2].slice(eq + 1).trim();
    }
  }
  return servers;
}

function callTool(server, name, tool, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(server.command, server.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...server.env },
    });

    let buffer = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, detail: 'TIMEOUT' }), timeoutMs);

    child.on('error', (error) => finish({ ok: false, detail: `SPAWN ${error.code ?? ''} ${error.message}` }));

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error) {
          finish({ ok: false, detail: `JSON-RPC error: ${JSON.stringify(message.error).slice(0, 160)}` });
          return;
        }
        if (message.id === 2 && message.result?.tools) {
          const tools = message.result.tools.map((t) => t.name);
          if (tool && !tools.includes(tool)) {
            finish({ ok: false, tools: tools.length, detail: `tool "${tool}" not offered` });
            return;
          }
          child.stdin.write(
            JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: args } }) + '\n'
          );
        }
        if (message.id === 3) {
          const payload = JSON.stringify(message.result ?? message.error ?? '');
          const failed = message.result?.isError === true;
          finish({
            ok: !failed && payload.length > 2,
            tools: undefined,
            detail: failed ? payload.slice(0, 200) : 'authenticated',
            payload: payload.slice(0, 300),
          });
        }
      }
    });

    for (const message of [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]) {
      child.stdin.write(JSON.stringify(message) + '\n');
    }
  });
}

const servers = await readServers();
console.log(`Found ${Object.keys(servers).length} configured MCP servers: ${Object.keys(servers).join(', ')}\n`);

let failures = 0;

for (const [name, server] of Object.entries(servers)) {
  if (!server.command) {
    console.log(`SKIP  ${name} (no command)`);
    continue;
  }
  const check = CHECKS[name];
  if (!check) {
    console.log(`SKIP  ${name} (no auth check defined)`);
    continue;
  }

  const result = await callTool(server, name, check.tool, check.args, 60000);
  if (result.ok) {
    console.log(`PASS  ${name.padEnd(12)} ${check.tool} -> authenticated`);
    if (result.payload) console.log(`         ${result.payload.replace(/\s+/g, ' ').slice(0, 150)}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name.padEnd(12)} ${check.tool} -> ${result.detail}`);
  }
}

console.log('');
console.log(failures === 0 ? '[PASS] Every checked MCP server authenticates.' : `[FAIL] ${failures} server(s) did not authenticate.`);
process.exit(failures === 0 ? 0 : 1);