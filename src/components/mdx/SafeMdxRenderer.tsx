import { compile, run } from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';
import { MDX_COMPONENTS } from './blocks';
import { extractClassCandidates } from '@/lib/compile';

/**
 * Components that MUST be client-side for their effect to work.
 *
 * The MDX renderer below is a SERVER component, and a server component cannot
 * import a client component and pass it children that contain other server
 * components... unless the client boundary is declared here. Next.js resolves
 * the 'use client' directive at module level, so these are already client
 * components by the time the map is built — this list exists to make the
 * boundary explicit and testable rather than implicit.
 */
export const CLIENT_MOTION_COMPONENTS = [
  'Reveal',
  'Parallax',
  'StatCounter',
  'TiltCard',
  'StickyScene',
  'ScrollProgress',
  'Marquee',
] as const;

/**
 * Resilient MDX renderer.
 *
 * Flaw this closes: a single malformed MDX payload would otherwise take down a
 * whole tenant page with a 500. Three layers of defence:
 *
 *   1. The workflow's pre-flight gate (`validateAndCompile`) normally prevents
 *      broken MDX from ever being stored.
 *   2. Here, compilation is wrapped in try/catch and a failure renders a plain
 *      <pre> of the raw source instead of throwing.
 *   3. All content is server-rendered; no client JS is shipped for it.
 *
 * Anything the AI emits can only reach `MDX_COMPONENTS`.
 */
export interface RenderedMdx {
  ok: boolean;
  element: React.ReactNode;
  error?: string;
}

export async function renderMdx(source: string): Promise<RenderedMdx> {
  if (!source || !source.trim()) {
    return { ok: true, element: null };
  }

  try {
    const compiled = await compile(source, {
      // jsx: false, NOT true.
      //
      // With jsx: true the compiler emits raw JSX ("return <><section ...>") and
      // relies on a BUNDLER's JSX transform to turn it into jsx() calls. That
      // transform only runs for .mdx FILES; here we compile a plain string at
      // request time, so nothing transforms it and run() dies with
      // "SyntaxError: Unexpected token '<'" from new AsyncFunction.
      //
      // The renderer's catch then silently replaced every AI-authored section
      // with a <pre> of the raw source, so tenant pages rendered as a wall of
      // unstyled JSX text while still returning HTTP 200 and "rendering".
      //
      // jsx: false makes the compiler emit _jsx() calls directly, which run()
      // executes against the react/jsx-runtime passed below.
      jsx: false,
      development: false,
      outputFormat: 'function-body',
      providerImportSource: undefined,
    });

    const { default: MDXContent } = await run(String(compiled), {
      ...runtime,
      baseUrl: import.meta.url,
    } as Parameters<typeof run>[1]);

    return { ok: true, element: <MDXContent components={MDX_COMPONENTS as never} /> };
  } catch (error: any) {
    // Falling back to raw text keeps the page (and its SEO value) alive even when
    // the markdown is malformed. It must still be LOGGED: when this path fires
    // silently, every AI-authored section renders as a <pre> of its own source,
    // the page returns HTTP 200, and nothing anywhere reports a problem - which is
    // exactly how the jsx:true defect survived a full end-to-end run.
    console.error('[renderMdx] MDX compile/run failed; falling back to raw source', {
      error: error?.message ?? String(error),
      sourceLength: source.length,
      sourceHead: source.slice(0, 120),
    });
    return {
      ok: false,
      error: error?.message ?? String(error),
      element: (
        <pre
          data-mdx-error
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: '.95rem',
            padding: '1rem',
            border: '1px solid color-mix(in srgb, var(--brand-accent) 45%, transparent)',
            borderRadius: 'var(--radius-card)',
          }}
        >
          {source}
        </pre>
      ),
    };
  }
}

/**
 * Stylesheet for a page's AI-authored classes, computed on demand. Used as a
 * fallback when `compiled_css` is empty in the database (e.g. rows written
 * before the compiler existed, or a workflow that skipped the gate).
 */
export async function cssForMdxSources(sources: string[]): Promise<string> {
  const classes = extractClassCandidates(sources);
  if (classes.length === 0) return '';
  const { compileTailwindCss } = await import('@/lib/compile');
  return compileTailwindCss(classes);
}