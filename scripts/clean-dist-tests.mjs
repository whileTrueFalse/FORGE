// Removes compiled *.test.js files from dist/ after tsc runs, so the
// published npm package doesn't ship test code. Deliberately NOT done via
// tsconfig's `exclude` -- excluding a file from the tsconfig removes it from
// that project's scope entirely, which breaks tsx's runtime type-stripping
// for that file (it silently falls back off the configured `jsx: "react-jsx"`
// transform, producing "React is not defined" for .test.tsx files run via
// `node --import tsx --test`). This script only touches the build OUTPUT,
// so `npm test` (which runs .test.ts/.tsx directly via tsx, never through
// dist/) is completely unaffected.

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

function removeCompiledTests(dir) {
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += removeCompiledTests(full);
    } else if (/\.test\.js(\.map)?$/.test(entry.name)) {
      rmSync(full);
      removed++;
    }
  }
  return removed;
}

const distDir = "dist";
try {
  statSync(distDir);
} catch {
  console.error(`${distDir}/ not found -- run tsc first`);
  process.exit(1);
}
const count = removeCompiledTests(distDir);
console.log(`clean-dist-tests: removed ${count} compiled test file(s) from ${distDir}/`);
