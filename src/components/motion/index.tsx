'use client';

/**
 * Motion primitives — the first CLIENT components in this engine.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `MDX_COMPONENTS` was a closed map of SERVER components. That is a hard ceiling:
 * server components ship no JavaScript, so no scroll animation, no 3D, and no
 * interactivity is *possible* in AI-authored content no matter how good the
 * prompt is. "The sites look basic" is not a tuning problem, it is this ceiling.
 *
 * This file adds the missing capability while preserving the property that made
 * the closed map safe: nothing here is addressed by raw selector or HTML. The
 * agent picks a component name and passes props; every animation is implemented
 * here, in code that shipped with the engine.
 *
 * SAFETY RULES OBSERVED
 * ---------------------
 * - Every effect is progressive enhancement: the content is in the DOM and
 *   readable BEFORE JS runs, so a JS failure degrades to static, not blank.
 *   (`gsap.from` is used, never `gsap.set(opacity: 0)`, so a hydration failure
 *   cannot hide content.)
 * - `prefers-reduced-motion` is honoured globally and per effect.
 * - No layout thrash: transforms and opacity only.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** True when the visitor has asked for reduced motion. SSR-safe (false on server). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Loads GSAP + ScrollTrigger only in the browser.
 *
 * Dynamic import matters: GSAP touches `window` and `self` at module scope, so a
 * static import would break server rendering of every page that includes motion.
 * Returns null during SSR, and callers no-op in that case.
 */
async function loadGsap() {
  if (typeof window === 'undefined') return null;
  const [{ gsap }, { ScrollTrigger }] = await Promise.all([
    import('gsap'),
    import('gsap/ScrollTrigger'),
  ]);
  gsap.registerPlugin(ScrollTrigger);
  return { gsap, ScrollTrigger };
}

/* ------------------------------------------------------------------ reveal */

export interface RevealProps {
  children?: ReactNode;
  /** Stagger the direct children instead of moving the wrapper as one block. */
  stagger?: number;
  /** Direction the content travels in from. */
  from?: 'bottom' | 'left' | 'right' | 'scale';
  /** Scroll position that fires the reveal. */
  start?: string;
  delay?: number;
  className?: string;
}

/**
 * Scroll-triggered reveal. Use on any block that should animate in.
 */
export function Reveal({
  children,
  stagger = 0,
  from = 'bottom',
  start = 'top 85%',
  delay = 0,
  className,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !ref.current) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const lib = await loadGsap();
      if (!lib || cancelled || !ref.current) return;
      const { gsap, ScrollTrigger } = lib;

      const offset = {
        bottom: { y: 48, x: 0 },
        left: { y: 0, x: -56 },
        right: { y: 0, x: 56 },
        scale: { y: 0, x: 0 },
      }[from];

      const targets = stagger > 0 ? Array.from(ref.current.children) : ref.current;
      if (stagger > 0 && (targets as Element[]).length === 0) return;

      const tween = gsap.from(targets, {
        opacity: 0,
        ...offset,
        scale: from === 'scale' ? 0.94 : 1,
        duration: 0.7,
        delay,
        ease: 'power2.out',
        stagger: stagger > 0 ? stagger : 0,
        scrollTrigger: { trigger: ref.current, start, once: true },
      });

      cleanup = () => {
        tween.scrollTrigger?.kill();
        tween.kill();
        ScrollTrigger.refresh();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reduced, from, start, delay, stagger]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- parallax */

export interface ParallaxProps {
  children?: ReactNode;
  /** Positive moves slower than scroll (recedes); negative moves faster. */
  speed?: number;
  className?: string;
}

/**
 * Vertical parallax on scroll. Transform-only, so it cannot trigger layout.
 */
export function Parallax({ children, speed = 0.18, className }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !ref.current) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const lib = await loadGsap();
      if (!lib || cancelled || !ref.current) return;
      const { gsap } = lib;

      const tween = gsap.fromTo(
        ref.current,
        { yPercent: speed * 50 },
        {
          yPercent: -speed * 50,
          ease: 'none',
          scrollTrigger: {
            trigger: ref.current,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        }
      );

      cleanup = () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reduced, speed]);

  return (
    <div ref={ref} className={className} style={{ willChange: 'transform' }}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- counters */

export interface StatCounterProps {
  stats?: { value: number; suffix?: string; prefix?: string; label: string }[];
  columns?: number;
}

/**
 * Count-up statistics. The number is rendered in the DOM at its FINAL value, so
 * it is correct without JS (important for SEO and for a JS failure).
 */
export function StatCounter({ stats = [], columns = 4 }: StatCounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !ref.current || stats.length === 0) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const lib = await loadGsap();
      if (!lib || cancelled || !ref.current) return;
      const { gsap } = lib;

      const nums = Array.from(ref.current.querySelectorAll<HTMLElement>('[data-count-to]'));
      const tweens = nums.map((el) => {
        const to = Number(el.dataset.countTo ?? 0);
        const state = { n: 0 };
        return gsap.to(state, {
          n: to,
          duration: 1.6,
          ease: 'power1.out',
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
          onUpdate: () => {
            el.textContent = String(Math.round(state.n));
          },
        });
      });

      // Killing a tween mid-flight leaves the DOM at whatever onUpdate last wrote.
      // The server-rendered value is the FINAL number (that is what makes it
      // SEO-safe and correct without JS), so a stranded intermediate is a wrong
      // fact on a client's page - "3319 root canals completed" instead of 4200 -
      // and nothing would report it. Restore each element to its target.
      cleanup = () => {
        tweens.forEach((t, i) => {
          t.scrollTrigger?.kill();
          t.kill();
          const el = nums[i];
          if (el && el.textContent !== el.dataset.countTo) {
            el.textContent = el.dataset.countTo ?? el.textContent;
          }
        });
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reduced, stats.length]);

  if (!stats.length) return null;

  return (
    <div
      ref={ref}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${Math.max(140, 600 / columns)}px, 1fr))`,
        gap: '1.5rem',
        margin: '2.5rem 0',
      }}
    >
      {stats.map((s) => (
        <div key={s.label} style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              lineHeight: 1,
              color: 'var(--brand-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {s.prefix}
            <span data-count-to={s.value}>{s.value}</span>
            {s.suffix}
          </div>
          <div className="shell-eyebrow" style={{ marginTop: '.4rem' }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- 3D tilt card */

export interface TiltCardProps {
  children?: ReactNode;
  /** Max rotation in degrees at the card's edge. */
  intensity?: number;
  className?: string;
}

/**
 * Pointer-tracking 3D tilt. Uses CSS `perspective` plus a rotate transform — no
 * WebGL and no three.js, so it costs ~1KB of behaviour and works on mobile
 * (where it simply does not tilt, since there is no pointer).
 */
export function TiltCard({ children, intensity = 8, className }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el) return;
    // Coarse pointers have no hover state to track; skip entirely.
    if (window.matchMedia('(pointer: coarse)').matches) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `rotateY(${px * intensity * 2}deg) rotateX(${-py * intensity * 2}deg)`;
      });
    };
    const onLeave = () => {
      el.style.transform = 'rotateX(0deg) rotateY(0deg)';
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced, intensity]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        transformStyle: 'preserve-3d',
        transition: 'transform .25s ease-out',
        perspective: '900px',
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- sticky scene */

export interface StickySceneProps {
  children?: ReactNode;
  /**
   * Scroll distance the section stays pinned for.
   * A NUMBER is viewport heights (2 = two screens). A STRING like "200vh" is
   * also accepted and normalised, because the agent prompt used to advertise
   * that form and the raw string reached a `height * 100` multiplication.
   */
  height?: number | string;
  className?: string;
}

/**
 * Pins a section while the rest of the page scrolls past it — the effect behind
 * most "3D scrolling" hero sequences.
 *
 * Implemented with CSS `position: sticky` rather than ScrollTrigger pinning:
 * ScrollTrigger taps into the DOM to add spacer elements, which fights React's
 * reconciler on re-render. Sticky is native, reversible, and cannot desync.
 */
export function StickyScene({ children, height = 2, className }: StickySceneProps) {
  // The agent was told to pass height="200vh" (a STRING), but the prop is a
  // number of viewport heights. "200vh" * 100 is NaN, which serialises as
  // height:NaNvh and collapses the sticky container to zero - the audit found
  // exactly that. Accept both forms: a bare number means "sticky for N
  // viewports", a vh/vw string means a raw CSS length.
  let vh: number;
  if (typeof height === 'string' && /^[\d.]+vh$/i.test(height.trim())) {
    vh = Number.parseFloat(height);
  } else {
    const n = Number(height);
    vh = Number.isFinite(n) && n > 0 ? n * 100 : 200;
  }
  return (
    <div className={className} style={{ position: 'relative', height: `${vh}vh` }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- scroll progress bar */

/** Thin progress bar showing reading position. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      el.style.transform = `scaleX(${pct})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [reduced]);

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 60,
        background: 'var(--brand-primary)',
        transformOrigin: '0 50%',
        transform: 'scaleX(0)',
      }}
      ref={ref}
    />
  );
}

/* ------------------------------------------------------------- marquee strip */

/** Continuously scrolling text strip (logos, accreditations, keywords). */
export function Marquee({ items = [], speed = 30 }: { items?: string[]; speed?: number }) {
  const reduced = useReducedMotion();
  if (!items.length) return null;

  // The list is duplicated so the loop is seamless; both copies are aria-hidden
  // except the first, so a screen reader hears the items once.
  const loop = [...items, ...items];

  return (
    <div
      style={{
        overflow: 'hidden',
        borderTop: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
        borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
        padding: '.75rem 0',
        margin: '2.5rem 0',
      }}
    >
      <div
        style={
          reduced
            ? { display: 'flex', gap: '3rem', justifyContent: 'center', flexWrap: 'wrap' }
            : {
                display: 'flex',
                gap: '3rem',
                width: 'max-content',
                animation: `shell-marquee ${speed}s linear infinite`,
              }
        }
      >
        {loop.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="shell-eyebrow"
            aria-hidden={i >= items.length}
            style={{ whiteSpace: 'nowrap' }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}