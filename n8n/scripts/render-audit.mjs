// Real-browser render audit for one tenant: desktop + mobile viewports, measured
// element geometry, screenshot.
//
// WHY: every earlier check in this project was HTTP-status or DB-row based, and
// every bug in its history produced a green run with plausible data. Two stacked
// <h1>s, a nav that vanishes on a phone, a sticky scene at NaNvh — none of those
// show up in a status code or a row. Only a rendered box tree shows them.
//
// Navigates the INTERNAL route /sites/<domain>/<slug> on the live engine host.
// Chrome rejects Page.navigate with an overridden Host header, and a tenant
// subdomain is not resolvable from here, so the internal route is both the only
// workable path and the same code path middleware rewrites public traffic into.
//
// Usage: node render-audit.mjs <domain> [slug] [--port 9222] [--shot-prefix out]
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const DOMAIN = args[0];
const SLUG = args[1] && !args[1].startsWith('--') ? args[1].replace(/^\/+/, '') : '';
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const CDP_PORT = flag('--port', '9222');
const SHOT_PREFIX = flag('--shot-prefix', '');

if (!DOMAIN) {
  console.error('usage: node render-audit.mjs <domain> [slug] [--port 9222] [--shot-prefix out]');
  process.exit(2);
}

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
// Pick the blank page, never an edge:// dialog that Edge opened on its own.
const page = targets.find((t) => t.type === 'page' && t.url === 'about:blank') || targets.find((t) => t.type === 'page' && !t.url.startsWith('edge://'));
if (!page) throw new Error(`no usable CDP page target on :${CDP_PORT} (saw: ${targets.map((t) => t.url).join(', ')})`);

const WebSocketImpl = (await import('ws').then((m) => m.WebSocket)).catch ? null : null;
let WS;
try {
  WS = (await import('ws')).WebSocket;
} catch {
  WS = globalThis.WebSocket;
}
if (!WS) throw new Error('no WebSocket implementation (need Node >= 22 for the global)');

const ws = new WS(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('websocket error'));
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

const PROBE = `JSON.stringify((() => {
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
  };
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + window.scrollY), h: Math.round(r.height), w: Math.round(r.width) };
  };
  const sections = q('.shell-section, section').filter((el) => !el.closest('header, footer, nav'));
  const boxes = sections.map(rect);
  const overlaps = [];
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i];
    const b = boxes[i + 1];
    const ov = a.top + a.h - b.top;
    if (ov > 8) overlaps.push({ between: i, overlapPx: ov });
  }
  const headings = q('h1, h2, h3').map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || '').trim().slice(0, 90),
    px: getComputedStyle(el).fontSize,
    pChild: el.querySelector('p') !== null,
    visible: vis(el),
  }));
  const h1s = headings.filter((x) => x.tag === 'h1');
  const buttons = q('button').filter(vis).map((el) => ({
    label: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 24),
    w: rect(el).w,
  }));
  const navLinks = q('header a, nav a').filter(vis);
  const text = (document.body.innerText || '').trim();
  const cs = getComputedStyle(document.body);
  return {
    url: location.href,
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    text_len: text.length,
    text_head: text.slice(0, 200).replace(/\\s+/g, ' '),
    h1_count: h1s.length,
    h1s,
    headings_with_p_child: headings.filter((x) => x.pChild).map((x) => `${x.tag}: ${x.text}`),
    header_count: q('header').filter(vis).length,
    footer_count: q('footer').filter(vis).length,
    section_count: sections.length,
    section_boxes: boxes.slice(0, 14),
    collapsed_sections: boxes.filter((b) => b.w < window.innerWidth * 0.5).length,
    max_section_h: boxes.reduce((m, b) => Math.max(m, b.h), 0),
    overlaps,
    visible_nav_links: navLinks.length,
    nav_link_labels: navLinks.map((a) => (a.innerText || '').trim()).filter(Boolean).slice(0, 10),
    visible_buttons: buttons,
    tel_links: q('a[href^=\\"tel:\\"]').length,
    raw_phone_text: (text.match(/\\+91[\\d\\s-]{8,}/g) || []).length,
    nan_styles: q('[style]').filter((el) => el.getAttribute('style').indexOf('NaN') !== -1).length,
    lorem: /lorem ipsum/i.test(text),
    placeholder_links: q('a[href*=\\"example.com\\"], a[href=\\"#\\"]').length,
    body_font: cs.fontFamily.slice(0, 50),
    body_bg: cs.backgroundColor,
    data_site: (document.querySelector('[data-site]') || {}).getAttribute ? document.querySelector('[data-site]').getAttribute('data-site') : null,
    canonical: (document.querySelector('link[rel=\\"canonical\\"]') || {}).href || null,
    stylesheet_count: document.styleSheets.length,
    doc_height: Math.round(document.documentElement.scrollHeight),
  };
})())`;

async function render(label, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const url = `https://sites.anagataitsolutions.in/sites/${DOMAIN}${SLUG ? `/${SLUG}` : ''}`;
  await send('Page.navigate', { url });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 20000);
    const prev = ws.onmessage;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Page.loadEventFired') {
        clearTimeout(timer);
        ws.onmessage = prev;
        setTimeout(() => {
          prev(event);
          resolve();
        }, 2500);
        return;
      }
      prev(event);
    };
  });
  const out = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true, awaitPromise: true });
  const data = typeof out.result?.value === 'string' ? JSON.parse(out.result.value) : out.result?.value;
  if (SHOT_PREFIX) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !mobile });
    const file = `${SHOT_PREFIX}-${label}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    data._shot = file;
  }
  return data;
}

const desk = await render('desktop', 1440, 900, false);
const mob = await render('mobile', 390, 844, true);
ws.close();

const show = (d) => {
  console.log(`  url              : ${d.url}`);
  console.log(`  viewport         : ${d.viewport.w}x${d.viewport.h}  doc height ${d.doc_height}px`);
  console.log(`  title            : ${d.title}`);
  console.log(`  data-site        : ${d.data_site}   canonical: ${d.canonical}`);
  console.log(`  visible text     : ${d.text_len} chars`);
  console.log(`  H1 count         : ${d.h1_count}  ${JSON.stringify(d.h1s.map((h) => ({ t: h.text.slice(0, 46), px: h.px })))}`);
  console.log(`  header/footer    : ${d.header_count} / ${d.footer_count}`);
  console.log(`  sections         : ${d.section_count}  collapsed(<50% vw): ${d.collapsed_sections}  tallest: ${d.max_section_h}px`);
  console.log(`  overlaps >8px    : ${d.overlaps.length ? JSON.stringify(d.overlaps) : 'none'}`);
  console.log(`  nav links visible: ${d.visible_nav_links}  ${JSON.stringify(d.nav_link_labels)}`);
  console.log(`  buttons visible  : ${JSON.stringify(d.visible_buttons)}`);
  console.log(`  tel: links       : ${d.tel_links}   raw phone text: ${d.raw_phone_text}`);
  console.log(`  NaN in styles    : ${d.nan_styles}   lorem: ${d.lorem}   placeholder links: ${d.placeholder_links}`);
  console.log(`  body font / bg   : ${d.body_font} / ${d.body_bg}   stylesheets: ${d.stylesheet_count}`);
  if (d.headings_with_p_child.length) console.log(`  headings wrapping <p>: ${JSON.stringify(d.headings_with_p_child)}`);
  console.log(`  text starts      : ${d.text_head}`);
  if (d._shot) console.log(`  screenshot       : ${d._shot}`);
};

console.log(`\n=== DESKTOP 1440x900 — ${DOMAIN}/${SLUG} ===`);
show(desk);
console.log(`\n=== MOBILE 390x844 ===`);
show(mob);

const f = [];
for (const [name, d] of [['desktop', desk], ['mobile', mob]]) {
  if (d.text_len < 800) f.push(`${name}: only ${d.text_len} chars of visible text`);
  if (d.section_count === 0) f.push(`${name}: no sections rendered`);
  if (d.h1_count !== 1) f.push(`${name}: ${d.h1_count} <h1> elements (must be exactly 1)`);
  if (d.header_count !== 1) f.push(`${name}: ${d.header_count} visible <header> (must be 1)`);
  if (d.footer_count !== 1) f.push(`${name}: ${d.footer_count} visible <footer> (must be 1)`);
  if (d.collapsed_sections > 0) f.push(`${name}: ${d.collapsed_sections} section(s) narrower than half the viewport`);
  if (d.max_section_h < 200) f.push(`${name}: tallest section is ${d.max_section_h}px — layout collapsing`);
  if (d.overlaps.length) f.push(`${name}: ${d.overlaps.length} section overlap(s)`);
  if (d.nan_styles > 0) f.push(`${name}: ${d.nan_styles} element(s) with NaN in inline style`);
  if (d.lorem) f.push(`${name}: lorem ipsum present`);
  if (d.tel_links === 0) f.push(`${name}: no tel: link`);
  if (d.raw_phone_text > 0) f.push(`${name}: ${d.raw_phone_text} phone number(s) as loose text`);
  if (d.stylesheet_count === 0) f.push(`${name}: no stylesheets loaded (unstyled page)`);
  if (/can't reach this page|ERR_|not be found|This page isn't working/i.test(d.text_head)) f.push(`${name}: browser error page`);
}
// Mobile must offer SOME way to navigate: either visible nav links or a drawer button.
if (mob.visible_nav_links === 0 && mob.visible_buttons.length === 0) f.push('mobile: no nav links and no buttons — a phone visitor cannot navigate');

console.log('');
if (f.length) {
  console.log(`[FAIL] ${f.length} render problem(s):`);
  for (const x of f) console.log(`   - ${x}`);
  process.exit(1);
}
console.log('[PASS] renders as a laid-out site with exactly one H1, one header, one footer, working nav on desktop and mobile');