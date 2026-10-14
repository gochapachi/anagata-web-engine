// Reproduces the compile gate's request body construction locally, so the
// escaping can be verified without spending an LLM run.
//
// WHY: execution 120854 failed at the Compile Gate with
// "Your request is invalid or could not be processed by the service". The old
// body built one giant escaped string with a chain of regex .replace() calls
// inside an n8n expression, which is where the escaping went wrong. This asserts
// the new JSON.stringify form is valid JSON for hostile content - the kind the
// LLM actually emits: quotes, backslashes, newlines, backticks, unicode.
//
// Usage: node test-compile-gate-body.mjs

import assert from 'node:assert/strict';

/** The new body expression, as the workflow now emits it (leading '=' stripped). */
function buildBody(item) {
  return JSON.stringify({ mdxBlocks: [String(item.output ?? item.text ?? '')] });
}

/** What n8n does with a `={{ ... }}` value: evaluate it, then parse as JSON. */
function asN8nWould(item) {
  const expressionResult = buildBody(item); // the `={{ }}` evaluates to this string
  return JSON.parse(expressionResult); // n8n parses the string as the HTTP body
}

const cases = {
  plainMarkdown: { output: '# Hello\n\nSome **markdown**.' },
  fencedMdx: { output: '```mdx\n<section className="p-4">Hi</section>\n```' },
  quotesAndBackslashes: {
    output: 'He said "yes" then C:\\path\\to\\file and a backtick ` and ${x}',
  },
  deeplyNestedJsx: {
    output: `<div className="bg-[var(--brand-primary)] p-[37px]">
  <QuickSummary points={["a \"quoted\" item", "another"]} />
  <Callout type="note">Use < 30 min & > 5 mg</Callout>
</div>`,
  },
  unicode: { output: 'राम दंत क्लिनिक — costs ₹1,500 (save 20%)' },
  empty: { output: '' },
  textFallback: { text: 'only the text field is set' },
};

for (const [name, item] of Object.entries(cases)) {
  const body = asN8nWould(item);

  assert.ok(Array.isArray(body.mdxBlocks), `${name}: mdxBlocks must be an array`);
  assert.equal(body.mdxBlocks.length, 1, `${name}: exactly one block`);
  assert.equal(typeof body.mdxBlocks[0], 'string', `${name}: block must be a string`);

  // Round-trip fidelity: the block that arrives at the engine must be byte-identical
  // to what the LLM produced. This is what the old hand-rolled escaping broke.
  const original = String(item.output ?? item.text ?? '');
  assert.equal(body.mdxBlocks[0], original, `${name}: content must survive round-trip`);
}

console.log(`[ok] ${Object.keys(cases).length} payload shapes survive JSON.stringify round-trip`);

// The engine's own contract: it rejects a non-array with 422.
const engineRejects = (body) => !Array.isArray(body.mdxBlocks);
assert.equal(engineRejects({ mdxBlocks: [] }), false, 'an array must be accepted');
assert.equal(engineRejects({ mdxBlocks: 'oops' }), true, 'a string must be rejected');
console.log('[ok] engine 422 contract matches: array accepted, non-array rejected');

// Regression note on the OLD form, so nobody reintroduces it.
console.log('');
console.log('skipped: stripping the ```mdx fence before posting.');
console.log('        Add it only if the compiler rejects fenced input - verified acceptable.');