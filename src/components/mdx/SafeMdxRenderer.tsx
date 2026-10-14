import { compile, run } from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';
import { MDX_COMPONENTS } from './blocks';
import { extractClassCandidates } from '@/lib/compile';

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
      jsx: true,
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
    // Falling back to raw text keeps the page (and its SEO value) alive even
    // when the markdown is malformed.
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