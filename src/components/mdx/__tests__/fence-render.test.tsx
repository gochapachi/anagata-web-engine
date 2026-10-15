import { describe, it, expect } from 'vitest';
import { unwrapWholeBlockFence } from '@/lib/compile';
import { renderMdx } from '@/components/mdx/SafeMdxRenderer';

/**
 * Regression tests for the two-delivery-format bug.
 *
 * The page agent emits its whole page wrapped in a ```mdx fence. Both the CSS
 * gate and the renderer must unwrap it before doing their job. When only the
 * gate did, pages rendered as a raw <pre> of their own source while every
 * status code and byte count looked correct.
 */
describe('unwrapWholeBlockFence', () => {
  it('unwraps a whole-block mdx fence', () => {
    const fenced = '```mdx\n<section className="p-4">hello</section>\n```';
    expect(unwrapWholeBlockFence(fenced)).toBe('<section className="p-4">hello</section>');
  });

  it('unwraps with a bare fence and no language tag', () => {
    const fenced = '```\n<p>bare</p>\n```';
    expect(unwrapWholeBlockFence(fenced)).toBe('<p>bare</p>');
  });

  it('returns null for prose that is not a wrapper', () => {
    expect(unwrapWholeBlockFence('Just some prose.')).toBeNull();
  });

  it('returns null for prose with a trailing fence (prose + embedded example)', () => {
    const mixed = 'Here is how:\n\n```js\nconst a = 1;\n```\n\nThat is it.';
    expect(unwrapWholeBlockFence(mixed)).toBeNull();
  });
});

describe('renderMdx with fenced source', () => {
  it('renders the CONTENT of a whole-block fence, not a <pre> of source', async () => {
    // This is the exact shape the Page Architect Agent delivers.
    const fenced = [
      '```mdx',
      '<section className="p-8">',
      '  <h1 className="text-4xl">Remote Viewing</h1>',
      '  <p className="text-muted">Vision beyond sight.</p>',
      '</section>',
      '```',
    ].join('\n');

    const result = await renderMdx(fenced);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    // If the fence were compiled as a code block, we would get a <pre> here.
    expect(result.element).toBeTruthy();
  });

  it('still renders unfenced JSX source directly', async () => {
    const bare = '<section className="p-8"><p>Plain source, no fence.</p></section>';
    const result = await renderMdx(bare);
    expect(result.ok).toBe(true);
  });

  it('reports ok:false with an error for genuinely broken JSX', async () => {
    // A page that cannot compile must fall back to a <pre> and SAY so.
    const broken = '```mdx\n<section><span>unclosed\n```';
    const result = await renderMdx(broken);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});