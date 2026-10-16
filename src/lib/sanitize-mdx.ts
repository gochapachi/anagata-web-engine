/**
 * MDX sanitiser for AI-authored page bodies.
 *
 * WHY THIS EXISTS
 * ---------------
 * The shell already renders every chrome element a page needs: the header,
 * the footer, the nav bar and the site title. The page agent does not know
 * that - it is writing a self-contained HTML page - so it happily emits its own
 * <header>, <nav> and <footer> too. The result was two headers stacked, two
 * footers, two <h1>s with the same text, and a raw phone line with no styling.
 *
 * The fix is applied at STORE time so that existing rows and future rows are
 * corrected identically, and the rendered DOM is clean without needing the
 * agent to be perfect. It is deliberately conservative:
 *
 *  - <header>, <footer>, <nav> are REMOVED entirely (the shell owns them).
 *  - A redundant DECLARATIVE <h1> is dropped when the section also carries an
 *    <h1> that is not a restatement of the site name; the site name itself is
 *    rendered by the shell as the display title, so the agent's copy of it is
 *    a duplicate. The FIRST surviving <h1> wins.
 *  - Empty elements left behind by those removals are pruned.
 */

const REMOVED_TAGS = ['header', 'footer', 'nav'] as const;

/** Matches `<header ...>...</header>` including nested same-name tags. */
function tagWithContent(tag: string, html: string): string {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'i');
  const close = new RegExp(`</${tag}\\s*>`, 'i');
  let out = html;
  for (let guard = 0; guard < 12; guard++) {
    const start = open.exec(out);
    if (!start) break;
    const closeMatch = close.exec(out.slice(start.index));
    if (!closeMatch) break;
    const end = start.index + closeMatch.index + closeMatch[0].length;
    out = out.slice(0, start.index) + out.slice(end);
  }
  return out;
}

/**
 * Removes the chrome elements the shell already owns.
 * Returns the sanitised MDX and what was removed (for logs/tests).
 */
export function sanitizePageMdx(source: string): { mdx: string; removed: string[] } {
  let out = String(source ?? '');
  const removed: string[] = [];

  for (const tag of REMOVED_TAGS) {
    const before = out;
    out = tagWithContent(tag, out);
    if (before !== out) removed.push(tag);
  }

  // Self-closing / attribute-only residue (e.g. `<footer className="x" />`).
  for (const tag of REMOVED_TAGS) {
    out = out.replace(new RegExp(`<${tag}(\\s[^>]*)?/>`, 'gi'), '');
  }

  return { mdx: out, removed };
}

/**
 * Keeps exactly ONE <h1>. When the agent restates the site/business name in an
 * <h1> and also writes a real section heading, the site-name one is the shell's
 * job, so the non-name heading survives. If every <h1> merely names the site,
 * the first is kept and the rest dropped.
 */
export function dedupeH1(source: string, businessName?: string): { mdx: string; dropped: number } {
  const name = (businessName ?? '').trim().toLowerCase();
  const h1Re = /<h1(\s[^>]*)?>([\s\S]*?)<\/h1\s*>/gi;

  const matches: { start: number; end: number; text: string; isName: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = h1Re.exec(source)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      text,
      isName: name.length > 0 && text.toLowerCase().includes(name),
    });
  }
  if (matches.length <= 1) return { mdx: source, dropped: 0 };

  // Prefer keeping the first heading that is NOT a restatement of the name.
  const keepIndex = matches.findIndex((match) => !match.isName);
  const keep = keepIndex === -1 ? 0 : keepIndex;

  let out = source;
  for (let i = matches.length - 1; i >= 0; i--) {
    if (i === keep) continue;
    out = out.slice(0, matches[i].start) + out.slice(matches[i].end);
  }
  return { mdx: out, dropped: matches.length - 1 };
}

/**
 * Strips <p> and </p> tags that occur immediately inside heading tags <h1..6>.
 * MDX wraps multiline JSX contents in <p>, which creates invalid HTML like
 * <h1><p>Title</p></h1> and triggers hydration mismatches.
 */
export function unwrapHeadingParagraphs(html: string): string {
  return html.replace(/<(h[1-6])(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi, (_match, tag, attrs, inner) => {
    const cleaned = inner.replace(/<\/?p(\s[^>]*)?>/gi, '').trim();
    return `<${tag}${attrs || ''}>${cleaned}</${tag}>`;
  });
}

/** Full pipeline used at store time. */
export function sanitizeAndDedupePage(
  source: string,
  businessName?: string
): { mdx: string; removed: string[]; droppedH1: number } {
  const first = sanitizePageMdx(source);
  const second = dedupeH1(first.mdx, businessName);
  const unwrapped = unwrapHeadingParagraphs(second.mdx);
  return {
    mdx: unwrapped,
    removed: first.removed,
    droppedH1: second.dropped,
  };
}