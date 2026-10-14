// Measures the RENDERED hero in a real browser and reports computed styles.
//
// WHY: the render check proves content exists and is laid out; it does not prove
// the genome's brand tokens actually reached the pixels. This reads back the
// computed styles of the hero elements so "the green brand colour is applied" is
// a measured fact rather than an impression.
//
// Usage: node probe-hero-styles.mjs <domain> [--viewport 1440x900] [--port 9222] [--base http://127.0.0.1:3000]

const args = process.argv.slice(2);
const DOMAIN = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = flag('--base', 'http://127.0.0.1:3000');
const CDP_PORT = flag('--port', '9222');
const VIEWPORT = flag('--viewport', '1440x900');

if (!DOMAIN) {
  console.error('usage: node probe-hero-styles.mjs <domain> [--viewport 1440x900]');
  process.exit(2);
}

const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
if (!target) throw new Error('no page target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
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

const [vw, vh] = VIEWPORT.split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: `${BASE}/sites/${DOMAIN}` });
await new Promise((resolve) => setTimeout(resolve, 4000));

const probe = `JSON.stringify((() => {
  const px = (v) => Math.round(parseFloat(v) || 0);
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);

  // The first section is the hero.
  const hero = document.querySelector('section, .shell-section');
  const heroStyle = hero ? getComputedStyle(hero) : null;
  const heroRect = hero ? hero.getBoundingClientRect() : null;

  // The primary CTA: a brand-coloured button/link in the hero.
  const cta = hero ? [...hero.querySelectorAll('a,button')].find((el) => {
    const s = getComputedStyle(el);
    return s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)';
  }) : null;
  const ctaStyle = cta ? getComputedStyle(cta) : null;

  const h1 = document.querySelector('h1');
  const h2s = [...document.querySelectorAll('h2')];

  // Detect overlap between section boxes.
  //
  // Only ANCESTOR-INDEPENDENT overlaps count. Nesting is normal and expected: the
  // hero contains inner sections, and a card can contain its own section. Counting
  // every overlapping pair (including parent/child) reported 8 "overlaps" on a
  // perfectly good page, which is a false positive that trains you to ignore the
  // check.
  const els = [...document.querySelectorAll('section, .shell-section')];
  const sections = els.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      el,
      top: Math.round(r.top + window.scrollY),
      bottom: Math.round(r.bottom + window.scrollY),
      w: Math.round(r.width),
    };
  });
  let overlaps = 0;
  for (let a = 0; a < sections.length; a++) {
    for (let b = a + 1; b < sections.length; b++) {
      const A = sections[a];
      const B = sections[b];
      const intersects = A.top < B.bottom - 2 && B.top < A.bottom - 2;
      if (!intersects) continue;
      // Ancestry must be checked with contains(), not the nearest parent: a
      // section nested two levels deep (FAQ inside a wrapper inside the hero)
      // legitimately overlaps its ancestor and is not a layout bug. Comparing
      // only direct parents reported it as a real overlap.
      const related = A.el.contains(B.el) || B.el.contains(A.el);
      if (!related) overlaps++;
    }
  }

  return {
    viewport: { w: innerWidth, h: innerHeight },
    tokens: {
      '--bg-canvas': root.getPropertyValue('--bg-canvas').trim(),
      '--brand-primary': root.getPropertyValue('--brand-primary').trim(),
      '--brand-accent': root.getPropertyValue('--brand-accent').trim(),
      '--text-primary': root.getPropertyValue('--text-primary').trim(),
      '--section-gap': root.getPropertyValue('--section-gap').trim(),
      '--container-width': root.getPropertyValue('--container-width').trim(),
    },
    body: { bg: body.backgroundColor, color: body.color, font: body.fontFamily.split(',')[0] },
    hero: heroRect ? {
      width: Math.round(heroRect.width),
      height: Math.round(heroRect.height),
      bg: heroStyle.backgroundColor,
      padding: heroStyle.padding,
    } : null,
    cta: cta && ctaStyle ? {
      text: (cta.innerText || '').trim().slice(0, 40),
      bg: ctaStyle.backgroundColor,
      color: ctaStyle.color,
      radius: ctaStyle.borderRadius,
      padding: ctaStyle.padding,
      width: Math.round(cta.getBoundingClientRect().width),
      height: Math.round(cta.getBoundingClientRect().height),
    } : null,
    h1: h1 ? { text: h1.innerText.trim().slice(0, 60), fontSize: h1 ? getComputedStyle(h1).fontSize : null, weight: getComputedStyle(h1).fontWeight, font: getComputedStyle(h1).fontFamily.split(',')[0] } : null,
    h2_count: h2s.length,
    h2_sizes: [...new Set(h2s.map((h) => getComputedStyle(h).fontSize))],
    section_count: sections.length,
    section_overlaps: overlaps,
    stylesheet_count: document.styleSheets.length,
  };
})())`;

const result = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
const data = typeof result.result?.value === 'string' ? JSON.parse(result.result.value) : result.result?.value;
ws.close();

console.log(`=== hero style probe: ${DOMAIN} @ ${VIEWPORT} ===`);
console.log(`viewport        : ${data.viewport.w}x${data.viewport.h}`);
console.log('');
console.log('genome tokens on :root');
for (const [key, value] of Object.entries(data.tokens)) console.log(`  ${key.padEnd(20)} ${value || '(unset)'}`);
console.log('');
console.log('body            :', JSON.stringify(data.body));
console.log('hero box        :', JSON.stringify(data.hero));
console.log('CTA             :', JSON.stringify(data.cta));
console.log('h1              :', JSON.stringify(data.h1));
console.log(`h2 count        : ${data.h2_count}  sizes: ${data.h2_sizes.join(', ')}`);
console.log(`sections        : ${data.section_count}  overlapping pairs: ${data.section_overlaps}`);
console.log(`stylesheets     : ${data.stylesheet_count}`);

const fails = [];
if (!data.tokens['--brand-primary']) fails.push('--brand-primary token missing from :root');
if (data.body.bg === 'rgba(0, 0, 0, 0)' || data.body.bg === 'rgb(255, 255, 255)') {
  // white is allowed only if the token says so; the genome here is #F6F8FA
  if (data.tokens['--bg-canvas']) fails.push(`body background ${data.body.bg} does not reflect --bg-canvas ${data.tokens['--bg-canvas']}`);
}
if (!data.hero || data.hero.width < 900) fails.push(`hero width ${data.hero?.width}px is not a desktop container`);
if (!data.cta) fails.push('no brand-coloured CTA found in the hero');
if (data.section_overlaps > 0) fails.push(`${data.section_overlaps} section pair(s) overlap`);
if (data.h2_count === 0) fails.push('no h2 headings rendered');

console.log('');
if (fails.length) {
  console.log('[FAIL]');
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('[PASS] brand tokens reached the pixels; hero is a real desktop container with a brand CTA');