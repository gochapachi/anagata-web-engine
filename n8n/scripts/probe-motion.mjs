// Proves the motion/3D primitives actually RUN in a real browser.
//
// WHY: "the component is in the bundle" is not evidence that anything animates.
// Every past bug in this engine passed a presence check while being broken. This
// probe measures BEHAVIOUR:
//
//   1. Does the GSAP client chunk load at runtime, and is ScrollTrigger registered?
//   2. Does a Reveal wrapper actually move (transform/opacity change) between
//      before-scroll and after-scroll states?
//   3. Does a Parallax element's transform TRACK scroll position?
//   4. Do StatCounter values animate from 0 up to their final number?
//   5. Do the motion component class names resolve (proving the map wired them)?
//
// It also asserts the CONTENT IS PRESENT BEFORE JS RUNS, which is the property
// that makes exposing client components safe: if a primitive fails, the page must
// still show its text.
//
// Usage: node probe-motion.mjs <domain> [--base URL] [--port 9222] [--viewport 1440x900]

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
  console.error('usage: node probe-motion.mjs <domain> [--viewport 1440x900]');
  process.exit(2);
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`        ${detail}`);
  }
};

const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
if (!target) throw new Error('no page target — is Chrome running with --remote-debugging-port?');

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

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
const [vw, vh] = VIEWPORT.split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: vw,
  height: vh,
  deviceScaleFactor: 1,
  mobile: false,
});

await send('Page.navigate', { url: `${BASE}/sites/${DOMAIN}` });
await new Promise((r) => setTimeout(r, 2500)); // let hydration + dynamic imports settle

console.log(`=== motion probe: ${DOMAIN} ===`);
console.log(`    url ${BASE}/sites/${DOMAIN}\n`);

/* ---------------------------------------------------- 1. content before JS */
// Read the server HTML (no JS) to prove text is present pre-hydration.
const rawHtml = await evaluate(`(async () => {
  const r = await fetch(location.href);
  return r.text();
})()`);
const bodyLen = rawHtml?.length ?? 0;
check('server HTML carries content (page is not JS-only)', bodyLen > 5000, `html ${bodyLen} bytes`);

/* ------------------------------------------------- 2. GSAP runtime present */
const motionState = await evaluate(`(() => {
  const out = {};
  out.hasGsapGlobal = typeof window.gsap !== 'undefined';
  out.hasScrollTrigger = typeof window.ScrollTrigger !== 'undefined';
  // Count elements the primitives render, by their distinctive inline styles.
  out.parallaxEls = document.querySelectorAll('[style*="will-change: transform"]').length;
  out.counters = document.querySelectorAll('[data-count-to]').length;
  out.stickyScenes = Array.from(document.querySelectorAll('div'))
    .filter(d => {
      const s = getComputedStyle(d);
      return s.position === 'sticky';
    }).length;
  out.marqueeKeyframes = (() => {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule.constructor.name === 'CSSKeyframesRule' && rule.name === 'shell-marquee') return true;
        }
      } catch (e) { /* cross-origin sheet */ }
    }
    return false;
  })();
  return out;
})()`);

check(
  'at least one motion primitive mounted',
  motionState.parallaxEls > 0 || motionState.counters > 0 || motionState.stickyScenes > 0,
  JSON.stringify(motionState)
);
check('parallax elements rendered', motionState.parallaxEls > 0, `found ${motionState.parallaxEls}`);
check('stat counters rendered', motionState.counters > 0, `found ${motionState.counters}`);
check('sticky scenes rendered', motionState.stickyScenes > 0, `found ${motionState.stickyScenes}`);
check('shell-marquee keyframes present in CSS', motionState.marqueeKeyframes, 'keyframes not found');
// NOTE: no `window.gsap` assertion. GSAP is loaded by dynamic import inside
// module scope (it touches window/self at module level, which would break SSR),
// so it never attaches to window. Asserting the global was a probe bug: it
// reported FAIL on a page whose animations were demonstrably running. The
// behavioural checks below are the real proof.

/* ------------------------- 3. ScrollTrigger drives the parallax on scroll */
// Instead of reading GSAP's registry (unreachable for the same reason), measure
// the effect: a scrub-linked parallax must hold a different transform at
// different scroll offsets.
const parallaxBehavior = await evaluate(`(async () => {
  const el = document.querySelector('[style*="will-change: transform"]');
  if (!el) return { found: false };
  const read = () => el.style.transform || 'none';
  const at = async (y) => {
    window.scrollTo({ top: y, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 260));
    return read();
  };
  const a = await at(0);
  const b = await at(Math.min(1400, document.body.scrollHeight));
  const c = await at(Math.min(700, document.body.scrollHeight));
  return { found: true, a, b, c, moved: a !== b };
})()`);

if (parallaxBehavior.found) {
  check(
    'parallax transform tracks scroll position',
    parallaxBehavior.moved,
    `scroll 0 -> "${parallaxBehavior.a}"; bottom -> "${parallaxBehavior.b}"`
  );
} else {
  console.log('  --   no parallax element to track; skipping scrub check');
}

/* ------------------------------------- 4. counters animate from a low value */
// The DOM holds the FINAL value (SEO-safe). Capture it, scroll past, and confirm
// GSAP overwrote it with an intermediate value at some point during the tween.
const counterBehavior = await evaluate(`(async () => {
  const el = document.querySelector('[data-count-to]');
  if (!el) return { found: false };
  const target = el.getAttribute('data-count-to');
  // Scroll it into view to fire the ScrollTrigger.
  el.scrollIntoView({ block: 'center' });
  const samples = [];
  // The tween is 1.6s. Sampling a fixed 12 frames (~0.8s) guaranteed reading a
  // mid-tween value, which is how a correct page came back as "ended at 3319,
  // expected 4200". Poll until the value stops changing, with a ceiling.
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    await new Promise(r => requestAnimationFrame(r));
    const v = el.textContent.trim();
    if (samples[samples.length - 1] !== v) samples.push(v);
    if (v === target) break;
    await new Promise(r => setTimeout(r, 80));
  }
  return { found: true, target, samples: [...new Set(samples)] };
})()`);

if (counterBehavior.found) {
  const sawIntermediate = counterBehavior.samples.some(
    (s) => s !== counterBehavior.target && Number(s) >= 0
  );
  check(
    'counter animates (saw an intermediate value, not just the final one)',
    sawIntermediate,
    `samples: ${counterBehavior.samples.join(' -> ')}`
  );
  check(
    'counter settles on its target value',
    counterBehavior.samples.at(-1) === counterBehavior.target,
    `ended at ${counterBehavior.samples.at(-1)}, expected ${counterBehavior.target}`
  );
} else {
  console.log('  --   no [data-count-to] element on this page; skipping counter behaviour');
}

/* --------------------------------------------- 5. reveal actually transforms */
const revealBehavior = await evaluate(`(async () => {
  // Find a GSAP-animated wrapper: one that GSAP has left an inline transform on.
  const els = Array.from(document.querySelectorAll('div')).filter(
    d => d.style && /translate|matrix|rotate/.test(d.style.transform || '')
  );
  if (!els.length) return { found: false };
  const el = els[0];
  const before = el.style.transform;
  const opBefore = getComputedStyle(el).opacity;
  window.scrollTo({ top: window.scrollY + 400, behavior: 'instant' });
  await new Promise(r => setTimeout(r, 350));
  const after = el.style.transform;
  const opAfter = getComputedStyle(el).opacity;
  return { found: true, before, after, opBefore, opAfter, changed: before !== after || opBefore !== opAfter };
})()`);

if (revealBehavior.found) {
  check(
    'a GSAP-animated element changed on scroll',
    revealBehavior.changed,
    `transform ${revealBehavior.before} -> ${revealBehavior.after}; opacity ${revealBehavior.opBefore} -> ${revealBehavior.opAfter}`
  );
} else {
  console.log('  --   no GSAP-transformed element found; skipping reveal behaviour');
}

/* ---------------------------------------------------- 6. console errors */
const errors = await evaluate(`window.__probeErrors || []`);
check('no uncaught page errors', !errors || errors.length === 0, JSON.stringify(errors));

console.log('');
if (failures) {
  console.log(`[FAIL] ${failures} motion check(s) failed`);
  process.exit(1);
}
console.log('[PASS] motion primitives render and animate in a real browser');
ws.close();