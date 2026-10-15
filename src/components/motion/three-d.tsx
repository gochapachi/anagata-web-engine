'use client';

/**
 * The "wow" layer — canvas particles, WebGL 3D scenes, and smooth scrolling.
 *
 * These ship as CLIENT components registered in the engine's closed MDX map, so
 * AI-authored pages can use them by name with props, exactly like the motion
 * primitives. Each is progressive enhancement: content reads before JS, and
 * prefers-reduced-motion is honoured.
 *
 * Bundle size strategy: tsParticles (slim preset) and three/R3F are heavy, so
 * they are loaded via dynamic import() inside effects. The component shell is
 * always rendered (a positioned div / canvas holder), the engine loads only on
 * interaction/scroll into view, and a JS failure degrades to a static,
 * readable section rather than a blank one.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from './index';

/* ------------------------------------------------------------- smooth scroll */

/**
 * Lenis smooth scroll, mounted ONCE per client page (from the tenant layout).
 * Lenis turns native scroll into an eased, GSAP-compatible scroll — the current
 * fixture of award-winning agency sites. `autoRaf: false` + gsap.ticker keeps
 * it in lock-step with ScrollTrigger so pinned scenes don't jitter.
 *
 * Rendered as a no-op wrapper so it composes like other shell components.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (reduced) return; // native scroll is correct when reduced motion is asked
    let lenis: any = null;
    let cancelled = false;

    (async () => {
      const [{ default: Lenis }, { gsap }, { ScrollTrigger }] = await Promise.all([
        import('lenis'),
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      gsap.registerPlugin(ScrollTrigger);
      if (cancelled) return;

      lenis = new Lenis({ autoRaf: false, duration: 1.15 });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time: number) => lenis?.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      lenis?.destroy();
    };
  }, [reduced]);

  // Class hook for shell CSS to adjust fixed-position elements if needed.
  return <div className={ready ? 'lenis-started' : ''} style={{ display: 'contents' }}>{children}</div>;
}

/* ------------------------------------------------------------ particle field */

export interface ParticleFieldProps {
  /** Rough particle density: 20-60 is subtle, 80-140 is rich. */
  density?: number;
  /** Palette of particle colours. Defaults to the brand hue (var(--brand-primary)). */
  colors?: string[];
  /** Connection lines between nearby particles. */
  links?: boolean;
  /** Fade the field so it sits behind a headline rather than shouting over it. */
  opacity?: number;
  className?: string;
  height?: string;
}

/**
 * Canvas particle background via tsParticles (slim preset).
 * SSR-safe: renders a sized div; the engine loads only in the browser.
 * `prefers-reduced-motion` disables movement entirely (static dots).
 */
export function ParticleField({
  density = 70,
  colors,
  links = true,
  opacity = 0.5,
  className,
  height = '100%',
}: ParticleFieldProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let engine: any = null;

    (async () => {
      // Slim preset registers the common interactions (connect, push, attract)
      // without the whole engine — keeps the dynamic chunk small. In v4 the
      // import returns an initializer, not the instance: loadSlim() augments
      // the singleton engine from '@tsparticles/engine'.
      const [{ loadSlim }, { tsParticles }] = await Promise.all([
        import('@tsparticles/slim'),
        import('@tsparticles/engine'),
      ]);
      await loadSlim(tsParticles);
      if (cancelled || !el) return;

      const base = Array.isArray(colors) && colors.length ? colors : ['var(--brand-primary)'];
      const cssVarColors = base.map((c) => (c.startsWith('--') ? `var(${c})` : c));

      await tsParticles.load({
        id: `pf-${Math.random().toString(36).slice(2, 9)}`,
        element: el,
        options: {
          fullScreen: { enable: false },
          fpsLimit: 60,
          background: { opacity: 0 },
          particles: {
            number: { value: reduced ? 12 : density, density: { enable: true } },
            color: { value: cssVarColors },
            opacity: { value: opacity, anim: { enable: !reduced, speed: 0.4, sync: false } },
            size: { value: { min: 1, max: 3 }, anim: { enable: !reduced, speed: 2 } },
            move: {
              enable: !reduced,
              speed: 0.7,
              direction: 'none',
              outModes: 'out',
            },
            links: links
              ? {
                  enable: !reduced,
                  color: cssVarColors[0] ?? '#999',
                  distance: 130,
                  opacity: 0.25,
                  width: 1,
                }
              : { enable: false },
          },
          interactivity: {
            events: { onHover: { enable: !reduced, mode: 'grab' }, resize: { enable: true } },
            modes: { grab: { distance: 140, links: { opacity: 0.35 } } },
          },
        },
      });
      engine = tsParticles;
    })();

    return () => {
      cancelled = true;
      engine?.destroy?.();
    };
  }, [density, colors, links, opacity, reduced]);

  return (
    <div
      ref={ref}
      className={className}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        height,
        width: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

/* ------------------------------------------------------------------ scene 3D */

export interface Scene3DProps {
  /** Short label for screen readers (the mesh itself is decorative). */
  label?: string;
  /** Rotation speed multiplier. 1 is calm, 2-3 is lively. */
  speed?: number;
  /** Geometry: 'torus' (donut), 'icosahedron' (geodesic), 'sphere', 'torus-knot'. */
  shape?: 'torus' | 'icosahedron' | 'sphere' | 'torus-knot';
  /** Colour; defaults to the brand var. */
  color?: string;
  /** Wireframe look (lighter, very 'tech'). */
  wireframe?: boolean;
  height?: number;
  className?: string;
}

/**
 * WebGL scene via React Three Fiber + drei, rendered into a fixed-size holder.
 * Heavier than the CSS/GSAP effects (~120KB dynamic chunk) — load exactly ONE
 * of these per page (the hero). Everything here is decorative: no interaction
 * needed for reward, so it also works as ambient motion behind a headline.
 */
export function Scene3D({
  label = 'Decorative 3D shape',
  speed = 1,
  shape = 'torus',
  color = 'var(--brand-primary)',
  wireframe = false,
  height = 420,
  className,
}: Scene3DProps) {
  const [loaded, setLoaded] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('./scene-three');
      if (cancelled) return;
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // SSR + reduced-motion both render a static gradient placeholder — the
  // content is decorative so nothing is lost, and no <canvas> ships when it is
  // not asked for.
  if (reduced || !loaded) {
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          height,
          width: '100%',
          borderRadius: 'var(--radius-card, 16px)',
          background:
            'radial-gradient(ellipse at 30% 30%, color-mix(in srgb, var(--brand-primary) 28%, transparent), transparent 65%), linear-gradient(135deg, var(--bg-surface), var(--bg-canvas))',
          border: '1px solid color-mix(in srgb, var(--text-primary) 10%, transparent)',
        }}
      />
    );
  }

  return <Scene3DCanvas label={label} speed={speed} shape={shape} color={color} wireframe={wireframe} height={height} className={className} />;
}

/** The actual canvas mount, split so the dynamic import stays isolated. */
function Scene3DCanvas(props: Scene3DProps) {
  const { label, speed = 1, shape = 'torus', color = 'var(--brand-primary)', wireframe = false, height = 420, className } = props;
  const [Scene, setScene] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Scene3DCanvasInner } = await import('./scene-three');
      if (!cancelled) setScene(() => Scene3DCanvasInner);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Scene) {
    return (
      <div role="img" aria-label={label} style={{ height, width: '100%' }} className={className} />
    );
  }

  return (
    <div role="img" aria-label={label} style={{ height, width: '100%', position: 'relative' }} className={className}>
      <Scene speed={speed} shape={shape} color={color} wireframe={wireframe} />
    </div>
  );
}