#!/usr/bin/env node
// Verify an MCP server actually launches and discovers tools, the way Hermes invokes it.
//
// Hermes spawns MCP servers as child processes speaking stdio JSON-RPC. A server that
// "works from your shell" can still fail here (Windows .cmd shims, missing env, bad args).
// NEVER report an MCP server as installed without a tool count from this script.
//
// Usage:
//   node verify_mcp_server.mjs -- node /abs/path/dist/index.js
//   node verify_mcp_server.mjs -- node /abs/path/dist/index.js --env FOO=bar --env BAZ=qux
//
// Options:
//   --env K=V        set an env var for the child (repeatable). Use for credentials.
//   --timeout N      ms before giving up (default 60000)
//   --quiet          print only the summary line
//
// Exit codes: 0 = tools discovered, 1 = spawn error / no tools/list response.

import { spawn } from "child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1) {
  console.error("usage: node verify_mcp_server.mjs -- <command> [args...] [--env K=V] [--timeout N] [--quiet]");
  process.exit(1);
}

const tail = argv.slice(sep + 1);
const cmdParts = [];
const env = { ...process.env };
let timeoutMs = 60000;
let quiet = false;

for (let i = 0; i < tail.length; i++) {
  const a = tail[i];
  if (a === "--env" && tail[i + 1]) {
    const eq = tail[++i].indexOf("=");
    if (eq > 0) env[tail[i].slice(0, eq)] = tail[i].slice(eq + 1);
  } else if (a === "--timeout" && tail[i + 1]) {
    timeoutMs = parseInt(tail[++i], 10) || timeoutMs;
  } else if (a === "--quiet") {
    quiet = true;
  } else {
    cmdParts.push(a);
  }
}

const [command, ...args] = cmdParts;
if (!command) {
  console.error("no command given");
  process.exit(1);
}

let child;
try {
  child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
} catch (e) {
  console.error(`SPAWN ERROR (threw): ${e.message}`);
  process.exit(1);
}

// Windows .cmd / space-in-path diagnostics, since these are the common failure modes.
child.on("error", (e) => {
  console.error(`SPAWN ERROR: ${e.code || ""} ${e.message}`);
  if (e.code === "ENOENT") {
    console.error("  -> command not resolvable by native spawn.");
    console.error("     If this is npx/yarn/pnpm on Windows they are .cmd shims; see the skill's");
    console.error("     'Windows: invoke the entry script with node, not npx' section.");
  } else if (e.code === "EINVAL") {
    console.error("  -> .cmd/.bat needs shell:true, and shell:true breaks on paths with spaces");
    console.error("     (e.g. 'C:/Program Files/...'). Use: command 'node' + abs path to entry script.");
  }
  process.exit(1);
});

let buf = "";
let settled = false;

child.stdout.on("data", (d) => {
  buf += d.toString();
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id === 2 && m.result && Array.isArray(m.result.tools)) {
      settled = true;
      console.log(`LAUNCH OK — ${m.result.tools.length} tools discovered`);
      if (!quiet) {
        for (const t of m.result.tools) console.log(`  - ${t.name}`);
      }
      child.kill();
      process.exit(0);
    }
    if (m.error) {
      console.error(`server returned error: ${JSON.stringify(m.error).slice(0, 300)}`);
    }
  }
});

child.stderr.on("data", (d) => {
  if (!quiet) process.stderr.write(`[stderr] ${d.toString().slice(0, 400)}`);
});

for (const msg of [
  { jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "verify", version: "1.0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
]) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

setTimeout(() => {
  if (!settled) {
    console.error("TIMEOUT — no tools/list response. The server did not start correctly.");
    process.exit(1);
  }
}, timeoutMs);