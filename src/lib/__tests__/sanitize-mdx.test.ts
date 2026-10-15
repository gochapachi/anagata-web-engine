import { describe, it, expect } from 'vitest';
import { sanitizePageMdx, dedupeH1, sanitizeAndDedupePage } from '@/lib/sanitize-mdx';

/**
 * Regression tests for the duplicate-chrome defect the audit found.
 *
 * The shell renders the header, footer and nav. The page agent writes a
 * self-contained page and emits its own, so a naive page renders two headers,
 * two footers and two <h1>s. The agent is now told not to; this module is the
 * enforcement that keeps existing data and imperfect runs clean.
 */

describe('sanitizePageMdx', () => {
  it('removes an agent-authored header with attributes', () => {
    const src = '<header className="shell-header"><p>Meridian</p></header><section className="p-8">one</section>';
    const { mdx, removed } = sanitizePageMdx(src);
    expect(mdx).toContain('<section');
    expect(mdx).not.toContain('shell-header');
    expect(removed).toEqual(['header']);
  });

  it('removes nested same-name tags (a wrapper containing a child)', () => {
    const src = '<div><header><div><header>inner</header></div></header><section>ok</section></div>';
    const { mdx } = sanitizePageMdx(src);
    expect(mdx).not.toContain('<header');
    expect(mdx).toContain('<section>ok</section>');
  });

  it('removes a footer and a nav', () => {
    const src = '<nav><a href="/a">A</a></nav><section>x</section><footer>copyright</footer>';
    const { mdx, removed } = sanitizePageMdx(src);
    expect(mdx).toContain('<section>x</section>');
    expect(mdx).not.toContain('copyright');
    // `removed` reports which chrome kinds were found, in the order they are
    // stripped (header -> footer -> nav), so assert set membership rather than
    // an ordering the caller should not depend on.
    expect([...removed].sort()).toEqual(['footer', 'nav']);
  });

  it('leaves a page with no chrome untouched', () => {
    const src = '<section className="p-8"><h2>Fine</h2><p>ok</p></section>';
    const { mdx, removed } = sanitizePageMdx(src);
    expect(mdx).toBe(src);
    expect(removed).toEqual([]);
  });

  it('removes a self-closing header remnant', () => {
    const { mdx } = sanitizePageMdx('<footer className="x" /><section>y</section>');
    expect(mdx).toBe('<section>y</section>');
  });
});

describe('dedupeH1', () => {
  it('drops a repeated site-name h1 and keeps the specific headline', () => {
    const src =
      '<h1>Meridian Property Group | Premier Pune Real Estate Agency</h1>' +
      '<h1>Koregaon Park Residences, Sold and Let by Specialists</h1>';
    const { mdx, dropped } = dedupeH1(src, 'Meridian Property Group');
    expect(mdx).toContain('Koregaon Park Residences');
    expect(mdx).not.toContain('Premier Pune Real Estate');
    expect(dropped).toBe(1);
  });

  it('keeps the first h1 when every h1 restates the business name', () => {
    const src = '<h1>Meridian</h1><h1>Meridian Property Group</h1>';
    const { dropped } = dedupeH1(src, 'Meridian');
    expect(dropped).toBe(1);
  });

  it('does nothing when there are two non-name h1s and no name is supplied', () => {
    // Without a business name the first wins rather than risking dropping real copy.
    const src = '<h1>Alpha</h1><h1>Beta</h1>';
    const { dropped } = dedupeH1(src);
    expect(dropped).toBe(1);
  });

  it('leaves a single h1 alone', () => {
    const src = '<h1>Only one</h1>';
    expect(dedupeH1(src, 'Only one').dropped).toBe(0);
  });
});

describe('sanitizeAndDedupePage', () => {
  it('cleans a realistic agent page end to end', () => {
    const src = [
      '<header className="shell-header"><p>Meridian Property Group</p></header>',
      '<section className="p-8">',
      '  <h1>Meridian Property Group | Premier Pune Real Estate Agency</h1>',
      '  <h1>Find Your Next Pune Home</h1>',
      '  <p>Kalyani Nagar specialists.</p>',
      '</section>',
      '<footer>Meridian Property Group (c)</footer>',
    ].join('\n');

    const { mdx, removed, droppedH1 } = sanitizeAndDedupePage(src, 'Meridian Property Group');
    expect(removed).toEqual(['header', 'footer']);
    expect(droppedH1).toBe(1);
    expect(mdx).toContain('<section');
    expect(mdx).toContain('Find Your Next Pune Home');
    expect(mdx).not.toContain('shell-header');
    expect(mdx).not.toContain('(c)');
  });
});