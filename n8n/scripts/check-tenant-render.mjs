// Renders a tenant page in a REAL browser and asserts on measured geometry.
//
// WHY: every previous check was HTTP-status or database-row based. Rows landing in
// Postgres prove the pipeline, not that a visitor sees a website. This drives
// headless Edge/Chrome over CDP, waits for the load event, and reads back real
// box metrics so a CSS/layout failure cannot pass as a green run.
//
// IMPORTANT: it navigates to the INTERNAL route /sites/<domain> rather than
// setting a Host header. Chrome rejects Page.navigate with a Host header
// ("ERR_INVALID_ARGUMENT"), and the internal route is the same code path the
// middleware rewrites public traffic into.
//
// Usage:
//   node check-tenant-render.mjs <domain> [slug] [--base http://127.0.0.1:3000] [--port 9222] [--shot out.png]

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const DOMAIN = args[0];
const SLUG = args[1] && !args[1].startsWith('--') ? args[1] : '/';
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = flag('--base', 'http://127.0.0.1:3000');
const CDP_PORT = flag('--port', '9222');
const SHOT = flag('--shot', '');

if (!DOMAIN) {
  console.error('usage: node check-tenant-render.mjs <domain> [slug] [--base url] [--port 9222] [--shot out.png]');
  process.exit(2);
}

const cleanSlug = SLUG === '/' ? '' : `/${SLUG.replace(/^\/+/, '')}`;
const url = `${BASE}/sites/${DOMAIN}${cleanSlug}`;

/* ---------------------------------------------------- minimal CDP client */
const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target; start Edge/Chrome with --remote-debugging-port');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

// A headless browser's default viewport is ~500x320, and --window-size does not
// reliably apply to an already-open target. Without this, every responsive
// breakpoint resolves to mobile, section widths collapse to ~205px, and a layout
// that is fine on desktop looks broken - the measurement becomes a harness
// artifact instead of a fact about the site.
const VIEWPORT = flag('--viewport', '1440x900');
const [vw, vh] = VIEWPORT.split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: vw,
  height: vh,
  deviceScaleFactor: 1,
  mobile: false,
});

await send('Page.navigate', { url });
// Wait for the load event rather than a blind sleep, then a short settle.
await new Promise((resolve) => {
  const timer = setTimeout(resolve, 8000);
  const original = ws.onmessage;
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Page.loadEventFired') {
      clearTimeout(timer);
      setTimeout(resolve, 1200);
    }
    original(event);
  };
});

const probe = `JSON.stringify((() => {
  const body = document.body;
  const text = (body.innerText || '').trim();
  const sections = [...document.querySelectorAll('section, .shell-section')];
  const headings = [...document.querySelectorAll('h1, h2')];
  const links = [...document.querySelectorAll('a[href]')];
  const boxes = sections.map((el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, h: Math.round(r.height), w: Math.round(r.width) };
  });
  const h1 = headings.find((h) => h.tagName === 'H1');
  const styles = getComputedStyle(body);
  const root = getComputedStyle(document.documentElement);
  return {
    url: location.href,
    title: document.title,
    text_length: text.length,
    text_head: text.slice(0, 300),
    section_count: sections.length,
    boxes,
    max_box_height: boxes.reduce((m, b) => Math.max(m, b.h), 0),
    h1_text: h1 ? h1.innerText.trim().slice(0, 120) : null,
    h1_font_size: h1 ? getComputedStyle(h1).fontSize : null,
    link_count: links.length,
    tel_links: links.filter((a) => a.href.startsWith('tel:')).length,
    body_font: styles.fontFamily.slice(0, 60),
    body_bg: styles.backgroundColor,
    stylesheet_count: document.styleSheets.length,
    css_vars: {
      '--bg-canvas': root.getPropertyValue('--bg-canvas').trim(),
      '--brand-primary': root.getPropertyValue('--brand-primary').trim(),
      '--radius-card': root.getPropertyValue('--radius-card').trim(),
    },
  };
})())`;

const result = await send('Runtime.evaluate', { expression: probe, returnByValue: true, awaitPromise: true });
const data = typeof result.result?.value === 'string' ? JSON.parse(result.result.value) : result.result?.value;

if (SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
}

ws.close();

console.log(`=== render check: ${DOMAIN}${cleanSlug} ===`);
console.log(`url            : ${data.url}`);
console.log(`title          : ${data.title}`);
console.log(`visible text   : ${data.text_length} chars`);
console.log(`sections       : ${data.section_count}`);
console.log(`max box height : ${data.max_box_height}px`);
console.log(`h1             : ${data.h1_text ?? '(none)'}`);
console.log(`h1 font-size   : ${data.h1_font_size ?? '-'}`);
console.log(`links          : ${data.link_count} (${data.tel_links} tel:)`);
console.log(`body font      : ${data.body_font}`);
console.log(`body bg        : ${data.body_bg}`);
console.log(`css vars       : ${JSON.stringify(data.css_vars)}`);
console.log('');
console.log(`boxes          : ${JSON.stringify(data.boxes.slice(0, 8))}`);
console.log('');
console.log('first 300 chars of visible text:');
console.log(data.text_head);
if (SHOT) console.log(`\nscreenshot     : ${SHOT}`);

const failures = [];
if (data.text_length < 80) failures.push(`almost no visible text (${data.text_length} chars)`);
if (data.section_count === 0) failures.push('no sections rendered');
if (data.max_box_height < 60) failures.push(`tallest section box is ${data.max_box_height}px - layout is collapsing`);
if (!data.h1_text) failures.push('no H1 rendered');
if (data.link_count === 0) failures.push('no links rendered');
if (/can't reach this page|ERR_|not be found/i.test(data.text_head)) failures.push('browser showed an error page');

console.log('');
if (failures.length) {
  console.log('[FAIL] render check failed:');
  for (const failure of failures) console.log(`   - ${failure}`);
  process.exit(1);
}
console.log('[PASS] the tenant renders visible, laid-out content in a real browser');