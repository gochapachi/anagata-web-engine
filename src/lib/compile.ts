/**
 * Runtime MDX validation + Tailwind CSS compilation.
 *
 * THE FLAW THIS SOLVES. Tailwind v4 scans source files at BUILD time. An AI
 * agent writing `bg-[#0B241E] p-[37px]` into a database column three weeks
 * after the container was built produces classes Tailwind never saw, so the
 * section renders unstyled. Two mitigations live here:
 *
 *   1. `validateMdxSyntax` - compile the MDX before it is stored, so an
 *      unclosed tag or bad expression is rejected with a message the n8n agent
 *      can feed back to itself and fix. Nothing broken reaches the database.
 *
 *   2. `compileTailwindCss` - run Tailwind v4's compiler at REQUEST time over
 *      the classes actually present, and store the resulting CSS in
 *      `pages.compiled_css` / `posts.compiled_css`. The renderer inlines it, so
 *      arbitrary utilities work forever without a container rebuild.
 *
 * `compileTailwindCss` uses `@tailwindcss/postcss` with an `@source inline(...)`
 * directive. That form is used rather than the lower-level `compile()` from the
 * `tailwindcss` package because compiling `@import "tailwindcss"` directly
 * requires a `loadStylesheet` resolver the raw API does not provide; the
 * PostCSS plugin already owns stylesheet resolution correctly.
 */

import postcss from 'postcss';

export interface SyntaxResult {
  valid: boolean;
  error?: string;
}

export interface CompileResult {
  valid: boolean;
  css: string;
  classes: string[];
  /** Index of the failing block when `valid` is false. */
  blockIndex?: number;
  error?: string;
}

/**
 * Tailwind utility classes that appear inside JSX/MDX. Deliberately limited to
 * `className` attributes: scanning all CJK-style word soup for
 * `[a-z-]+` matches produces false positives that inflate the stylesheet.
 */
const CLASSNAME_PATTERNS = [
  /className\s*=\s*"([^"]*)"/g,
  /className\s*=\s*'([^']*)'/g,
  /className\s*=\s*\{\s*"([^"]*)"\s*\}/g,
  /className\s*=\s*\{\s*'([^']*)'\s*\}/g,
  /className\s*=\s*\{\s*`([^`]*)`\s*\}/g,
  /class\s*=\s*"([^"]*)"/g,
];

/**
 * Unwraps a fence that WRAPS THE WHOLE BLOCK, returning the inner content.
 * Returns null when the source is NOT a single wrapping fence.
 *
 * Exported because TWO consumers need the identical decision: the CSS gate
 * (`stripCodeFences`, below) and the page renderer. The agent's entire
 * deliverable is one ```mdx fence, so both must unwrap it. Keeping one
 * implementation means they cannot disagree — a previous split had the gate
 * unwrapping while the renderer compiled the fence itself as a markdown
 * *code block*, so every page rendered as a <pre> of its own source while
 * still returning HTTP 200 with correct CSS.
 */
export function unwrapWholeBlockFence(source: string): string | null {
  const text = String(source ?? '');
  const wrapper = /^\s*(?:```|~~~)[^\n]*\n([\s\S]*?)\n?\s*(?:```|~~~)\s*$/.exec(text);
  return wrapper ? wrapper[1] : null;
}

/**
 * Strips a code fence that WRAPS THE WHOLE BLOCK, leaving any inner example
 * fences alone.
 *
 * The previous implementation removed every ```...``` span. The agent's entire
 * deliverable is one ```mdx fence, so that deleted 100% of the content: zero
 * className tokens, zero classes, zero CSS, and `compiled_css` stored as '' on
 * every page of every site. The gate still reported valid:true, because an empty
 * string is valid MDX - which is why this survived a full end-to-end run and only
 * showed up as an unstyled page in a real browser.
 *
 * A fence is treated as a WRAPPER only when it opens the block (ignoring leading
 * whitespace) and the first closing fence is the final non-whitespace content.
 * Anything else is prose with embedded examples and is stripped as before.
 */
function stripCodeFences(source: string): string {
  const text = String(source ?? '');

  const unwrapped = unwrapWholeBlockFence(text);
  if (unwrapped !== null) return unwrapped;

  // No whole-block wrapper: drop embedded example fences so their contents are
  // not scraped as real markup.
  return text.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
}

/**
 * Extracts the unique set of class tokens referenced by `className`/`class`
 * attributes across the supplied source blocks.
 */
export function extractClassCandidates(blocks: string[] | string): string[] {
  const sources = Array.isArray(blocks) ? blocks : [blocks];
  const found = new Set<string>();

  for (const raw of sources) {
    const source = stripCodeFences(raw ?? '');
    for (const pattern of CLASSNAME_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        for (const token of match[1].split(/\s+/)) {
          const trimmed = token.trim();
          if (trimmed) found.add(trimmed);
        }
      }
    }
  }

  return [...found];
}

/**
 * Compiles the MDX and reports the first failure with its location. Uses the
 * same compiler the renderer uses, so "valid here" means "renders there".
 */
export async function validateMdxSyntax(source: string): Promise<SyntaxResult> {
  try {
    const { compile } = await import('@mdx-js/mdx');
    await compile(source, { jsx: true, format: 'mdx' });
    return { valid: true };
  } catch (error: any) {
    const message: string = error?.message ?? String(error);
    const line = error?.line ?? error?.position?.start?.line;
    const column = error?.column ?? error?.position?.start?.column;
    const where = line ? ` (line ${line}${column ? `, column ${column}` : ''})` : '';
    return { valid: false, error: `${message}${where}` };
  }
}

/**
 * Compiles an explicit list of class candidates to a standalone stylesheet.
 *
 * Uses `@source inline(...)` so nothing depends on files existing on disk - the
 * workflow passes class names straight from the generated MDX.
 */
export async function compileTailwindCss(candidates: string[]): Promise<string> {
  if (candidates.length === 0) return '';

  const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const source = [
    '@import "tailwindcss";',
    `@source inline("${candidates.map(esc).join(' ')}");`,
  ].join('\n');

  const postcssPlugin = await import('@tailwindcss/postcss');
  const pluginFactory: any = (postcssPlugin as any).default ?? postcssPlugin;
  const plugin = typeof pluginFactory === 'function' ? pluginFactory() : pluginFactory;

  const result = await postcss([plugin]).process(source, { from: undefined });
  return result.css;
}

/**
 * The n8n pre-flight gate: validate every MDX block, then compile one
 * stylesheet covering all of them. On the first syntax failure it returns
 * `valid: false`, the failing block index, and the compiler message - which the
 * workflow feeds straight back to its fixer agent.
 */
export async function validateAndCompile(blocks: string[]): Promise<CompileResult> {
  if (blocks.length === 0) {
    return { valid: true, css: '', classes: [] };
  }

  for (let index = 0; index < blocks.length; index++) {
    const result = await validateMdxSyntax(blocks[index]);
    if (!result.valid) {
      return {
        valid: false,
        css: '',
        classes: [],
        blockIndex: index,
        error: `Block ${index} does not compile: ${result.error}`,
      };
    }
  }

  const classes = extractClassCandidates(blocks);

  try {
    const css = await compileTailwindCss(classes);
    return { valid: true, css, classes };
  } catch (error: any) {
    return {
      valid: false,
      css: '',
      classes,
      error: `Tailwind compilation failed: ${error?.message ?? String(error)}`,
    };
  }
}

/**
 * Guards against the invalid-CSS trap this codebase has been bitten by before:
 * a nested `minmax()` inside `grid-template-columns` makes the browser discard
 * the whole declaration, silently collapsing a multi-column grid to one column.
 * Returns the offending selector/declaration pairs (empty when clean).
 */
export function findNestedMinmax(css: string): string[] {
  const offenders: string[] = [];
  const declarations = css.matchAll(/([^{}]+)\{([^{}]*grid-template-columns[^{}]*)\}/g);
  for (const [, selector, body] of declarations) {
    const value = /grid-template-columns\s*:\s*([^;}]+)/.exec(body)?.[1] ?? '';
    if (/minmax\([^()]*minmax\(/.test(value)) {
      offenders.push(`${selector.trim()} { grid-template-columns: ${value.trim()} }`);
    }
  }
  return offenders;
}

/**
 * Detects an ODD number of code fences.
 *
 * MDX does not treat this as an error - it swallows the rest of the document as
 * code, so the article renders as a single code block instead of failing. That
 * makes it a silent content-loss bug, which is why it is linted separately after
 * `validateMdxSyntax` has passed. Returns the offending fence line, or null.
 */
export function findUnbalancedCodeFence(source: string): { line: number } | null {
  const lines = (source ?? '').split('\n');
  let fenceLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fenceLines.push(i + 1);
  }
  if (fenceLines.length % 2 === 1) {
    return { line: fenceLines[fenceLines.length - 1] };
  }
  return null;
}