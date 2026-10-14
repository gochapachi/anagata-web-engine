import { describe, it, expect } from 'vitest';
import {
  extractClassCandidates,
  findUnbalancedCodeFence,
  validateMdxSyntax,
  compileTailwindCss,
  validateAndCompile,
} from './compile';

describe('extractClassCandidates', () => {
  it('pulls utility classes out of className attributes', () => {
    const found = extractClassCandidates(
      ['<div className="grid grid-cols-3 gap-6 p-8">x</div>'].join('\n')
    );
    for (const cls of ['grid', 'grid-cols-3', 'gap-6', 'p-8']) {
      expect(found).toContain(cls);
    }
  });

  it('handles arbitrary-value utilities with brackets, colons and slashes', () => {
    const found = extractClassCandidates(
      '<section className="bg-[#0B241E] p-[37px] rounded-[28px] grid-cols-[1.2fr_0.8fr] hover:bg-white/10">x</section>'
    );
    for (const cls of [
      'bg-[#0B241E]',
      'p-[37px]',
      'rounded-[28px]',
      'grid-cols-[1.2fr_0.8fr]',
      'hover:bg-white/10',
    ]) {
      expect(found).toContain(cls);
    }
  });

  it('deduplicates repeated classes', () => {
    const found = extractClassCandidates(
      '<div className="p-4 p-4">a</div><div className="p-4">b</div>'
    );
    expect(found.filter((c) => c === 'p-4')).toHaveLength(1);
  });

  it('ignores the contents of code fences', () => {
    const found = extractClassCandidates(['```html', '<div className="p-9">', '```'].join('\n'));
    expect(found).not.toContain('p-9');
  });

  it('handles className with a JSX expression container', () => {
    const found = extractClassCandidates('<div className={"flex items-center"}>x</div>');
    expect(found).toContain('flex');
    expect(found).toContain('items-center');
  });

  it('returns an empty array for text with no classes', () => {
    expect(extractClassCandidates('Just prose, no markup.')).toEqual([]);
  });

  it('keeps responsive and state variants intact', () => {
    const found = extractClassCandidates(
      '<div className="md:grid-cols-2 lg:grid-cols-4 dark:bg-black focus-visible:ring-2">x</div>'
    );
    expect(found).toContain('md:grid-cols-2');
    expect(found).toContain('lg:grid-cols-4');
    expect(found).toContain('dark:bg-black');
    expect(found).toContain('focus-visible:ring-2');
  });
});

describe('validateMdxSyntax', () => {
  it('accepts plain markdown', async () => {
    const result = await validateMdxSyntax('# Title\n\nSome paragraph text.');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts well-formed JSX inside MDX', async () => {
    const result = await validateMdxSyntax(
      '<Callout type="tip">\n\nBody text.\n\n</Callout>'
    );
    expect(result.valid).toBe(true);
  });

  it('accepts a self-closing component with props', async () => {
    const result = await validateMdxSyntax('<QuickSummary points={["a", "b"]} />');
    expect(result.valid).toBe(true);
  });

  it('rejects an unclosed JSX tag and reports a location', async () => {
    const result = await validateMdxSyntax('<div className="p-4"><span>unclosed</div>');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/closing tag|Expected/i);
  });

  it('accepts an unclosed code fence (MDX treats the rest as code) but the lint catches it', async () => {
    const source = '```js\nconst a = 1;\n';
    const result = await validateMdxSyntax(source);
    // MDX itself does NOT reject this - the remaining document becomes code.
    // That means a broken fence silently swallows the article instead of
    // 500-ing, so validation alone is not enough; the lint below is.
    expect(result.valid).toBe(true);
    expect(findUnbalancedCodeFence(source)).not.toBeNull();
  });

  it('the fence lint is null for balanced fences', () => {
    expect(findUnbalancedCodeFence('```js\nconst a = 1;\n```')).toBeNull();
    expect(findUnbalancedCodeFence('no fences here')).toBeNull();
  });

  it('reports the offending line when one is available', async () => {
    const result = await validateMdxSyntax('# ok\n\n<div>\n\nunclosed text\n');
    expect(result.valid).toBe(false);
  });

  it('accepts MDX with a table and inline code', async () => {
    const result = await validateMdxSyntax(
      ['| a | b |', '| - | - |', '| 1 | 2 |', '', 'Use `npm run build`.'].join('\n')
    );
    expect(result.valid).toBe(true);
  });

  it('accepts an escaped less-than so prose like "< 30 min" does not break', async () => {
    const result = await validateMdxSyntax('Wait &lt; 30 minutes, then retry.');
    expect(result.valid).toBe(true);
  });
});

describe('compileTailwindCss', () => {
  it('emits CSS for an arbitrary hex colour class', async () => {
    const css = await compileTailwindCss(['bg-[#0B241E]']);
    expect(css).toContain('#0B241E');
  });

  it('emits CSS for arbitrary px spacing and radius', async () => {
    const css = await compileTailwindCss(['p-[37px]', 'rounded-[28px]']);
    expect(css).toContain('37px');
    expect(css).toContain('28px');
  });

  it('emits a valid grid-template-columns for arbitrary fractions', async () => {
    const css = await compileTailwindCss(['grid-cols-[1.2fr_0.8fr]']);
    expect(css).toContain('1.2fr');
    expect(css).toContain('0.8fr');
  });

  it('emits responsive variants inside a media query', async () => {
    const css = await compileTailwindCss(['lg:grid-cols-3']);
    expect(css).toContain('grid-cols-3');
    expect(css).toMatch(/@media/);
  });

  it('emits nothing useful for an empty candidate list but stays valid CSS', async () => {
    const css = await compileTailwindCss([]);
    expect(typeof css).toBe('string');
  });

  it('never emits nested minmax() in grid-template-columns (the classic invalid-CSS trap)', async () => {
    const css = await compileTailwindCss(['grid-cols-[minmax(0,1fr)_minmax(0,2fr)]']);
    // A nested minmax makes the browser drop the whole declaration.
    expect(css).not.toMatch(/minmax\([^)]*minmax\(/);
  });
});

describe('validateAndCompile (the n8n pre-flight gate)', () => {
  it('validates clean MDX and returns compiled CSS in one call', async () => {
    const result = await validateAndCompile([
      '<section className="bg-[#0B241E] p-[37px]">\n\n# Heading\n\nText.\n\n</section>',
    ]);
    expect(result.valid).toBe(true);
    expect(result.css).toContain('#0B241E');
    expect(result.css).toContain('37px');
    expect(result.classes).toContain('bg-[#0B241E]');
    expect(result.blockIndex).toBeUndefined();
  });

  it('reports which block failed and passes the error back for self-healing', async () => {
    const result = await validateAndCompile([
      '# fine\n\nok',
      '<div className="p-4"><span>broken</div>',
    ]);
    expect(result.valid).toBe(false);
    expect(result.blockIndex).toBe(1);
    expect(result.error).toBeTruthy();
    expect(result.css).toBe('');
  });

  it('aggregates classes across every block so one stylesheet covers the page', async () => {
    const result = await validateAndCompile([
      '<div className="p-4">a</div>',
      '<div className="m-[13px]">b</div>',
    ]);
    expect(result.valid).toBe(true);
    expect(result.classes).toContain('p-4');
    expect(result.classes).toContain('m-[13px]');
    expect(result.css).toContain('13px');
  });

  it('handles an empty block list', async () => {
    const result = await validateAndCompile([]);
    expect(result.valid).toBe(true);
    expect(result.css).toBe('');
    expect(result.classes).toEqual([]);
  });
});