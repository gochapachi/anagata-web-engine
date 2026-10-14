// Checks that neither branch of the blog publisher's IF reaches into the other.
//
// This is the defect that broke the site builder: $('SiblingBranch').all() THROWS
// when that node sits on the untaken branch of an IF, so the happy path was the
// case that failed. Static check, no execution needed.
//
// Usage: node check-if-branches.mjs [workflow.json ...]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath decodes %20; using pathname directly left the space encoded,
// which made readFileSync look for a directory that does not exist.
const here = path.dirname(fileURLToPath(import.meta.url));
const WF_DIR = path.join(here, '..', 'workflows');

/** Which nodes sit on mutually exclusive IF branches. */
const BRANCH_GROUPS = [
  { if_: 'MDX Valid?', branches: ['Assemble Valid Page', 'Salvage MDX Blocks'] },
  { if_: 'MDX Valid?', branches: ['Assemble Blog Post', 'Salvage Blog MDX'] },
];

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      path.join(WF_DIR, 'nextjs-multi-tenant-site-builder.json'),
      path.join(WF_DIR, 'nextjs-multi-tenant-blog-publisher.json'),
    ];

const stripComments = (code) => code.replace(/^\s*\/\/.*$/gm, '');

let problems = 0;

for (const file of files) {
  const workflow = JSON.parse(readFileSync(file, 'utf8'));
  const name = path.basename(file);
  console.log(`\n=== ${name} ===`);

  for (const group of BRANCH_GROUPS) {
    const present = group.branches.filter((branch) =>
      workflow.nodes.some((node) => node.name === branch)
    );
    if (present.length < 2) continue; // only the site builder has the page pair
    if (!workflow.nodes.some((node) => node.name === group.if_)) continue;

    for (const node of workflow.nodes) {
      const code = node.parameters?.jsCode;
      if (typeof code !== 'string') continue;
      const live = stripComments(code);
      const reaches = [...live.matchAll(/\$\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);

      for (const target of reaches) {
        const crosses = group.branches.includes(node.name) && group.branches.includes(target);
        if (crosses) {
          console.log(`  [CROSS] ${node.name} -> ${target}`);
          problems++;
        } else {
          console.log(`  ok      ${node.name} -> ${target}`);
        }
      }
    }
  }

  // Merges must read only their own input.
  for (const node of workflow.nodes) {
    if (!/^Merge (Page|Blog) Results$/.test(node.name)) continue;
    const live = stripComments(node.parameters.jsCode ?? '');
    const usesInput = /\$input\.all\(\)/.test(live);
    const reachesBranch = /(Salvage|Assemble) (MDX Blocks|Valid Page|Blog MDX|Blog Post)/.test(live);
    const status = usesInput && !reachesBranch ? 'ok' : 'CROSS';
    console.log(`  [${status}] ${node.name}: reads $input.all()=${usesInput} reaches-branch=${reachesBranch}`);
    if (status === 'CROSS') problems++;
  }
}

console.log('');
console.log(problems === 0 ? '[ok] no IF branch reaches a sibling branch' : `[FAIL] ${problems} cross-branch reference(s)`);
process.exit(problems === 0 ? 0 : 1);