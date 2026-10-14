import { NextRequest, NextResponse } from 'next/server';
import { validateAndCompile, findNestedMinmax, findUnbalancedCodeFence } from '@/lib/compile';

/**
 * Pre-flight gate for BOTH n8n workflows.
 *
 * The workflow posts every MDX block it generated (page sections, blog body)
 * and gets back one stylesheet plus a validity verdict. On failure it receives
 * the failing block index and the compiler's own message, which it feeds to a
 * fixer agent and retries - so malformed content is repaired before it reaches
 * the database instead of 500-ing a live tenant page later.
 *
 * Optional shared-secret auth: set `ENGINE_COMPILE_SECRET` to lock this down.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const expected = process.env.ENGINE_COMPILE_SECRET;
  if (expected) {
    const provided =
      req.headers.get('x-compile-secret') ??
      (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: { mdxBlocks?: unknown; blocks?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const raw = body.mdxBlocks ?? body.blocks;
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { error: 'mdxBlocks must be an array of strings' },
      { status: 422 }
    );
  }
  const blocks = raw.map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')));

  const result = await validateAndCompile(blocks);

  if (!result.valid) {
    return NextResponse.json(
      {
        valid: false,
        blockIndex: result.blockIndex ?? null,
        error: result.error,
        // The workflow retries with this hint attached to the fixer prompt.
        hint: 'Fix the MDX syntax in the listed block, then POST again.',
      },
      { status: 422 }
    );
  }

  // Extra lints that do not prevent compilation but do cause silent content
  // loss at render time.
  const unbalancedFences = blocks
    .map((block, index) => ({ index, fence: findUnbalancedCodeFence(block) }))
    .filter((entry) => entry.fence !== null);
  const nestedMinmax = findNestedMinmax(result.css);

  return NextResponse.json({
    valid: true,
    css: result.css,
    cssBytes: result.css.length,
    classes: result.classes,
    warnings: [
      ...unbalancedFences.map(
        (entry) => `Block ${entry.index} has an unclosed code fence at line ${(entry.fence as { line: number }).line}`
      ),
      ...nestedMinmax.map((declaration) => `Invalid nested minmax in CSS: ${declaration}`),
    ],
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/compile',
    method: 'POST',
    body: { mdxBlocks: ['<div className="p-4">…</div>'] },
    returns: {
      success: { valid: true, css: 'string', classes: 'string[]', warnings: 'string[]' },
      failure: { valid: false, blockIndex: 'number', error: 'string' },
    },
  });
}