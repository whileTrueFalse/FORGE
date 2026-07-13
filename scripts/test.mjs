// Portable test runner: discover every *.test.ts / *.test.tsx under src/ and run
// them with the node test runner + the tsx loader.
//
// Why not `node --test "src/**/*.test.ts"`? Glob patterns in `--test` are only
// supported on Node 21+. On Node 20 (which we support and test in CI) node
// treats the pattern as a literal path, finds nothing, and exits 1. Discovering
// the files ourselves and passing explicit paths works on Node 20+ and every OS.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTests(full));
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = findTests("src").sort();
if (files.length === 0) {
  console.error("no test files found under src/");
  process.exit(1);
}

const res = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
