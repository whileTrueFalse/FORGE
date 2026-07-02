// Tests the project detector used by `forge init` to auto-configure a target.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectProject } from "./detect.js";

function tmp(pkg: unknown | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-detect-"));
  if (pkg !== null) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

test("detect: direct `node` start script → target", () => {
  const d = detectProject(tmp({ scripts: { start: "node src/server.mjs" } }));
  assert.equal(d.kind, "node");
  assert.deepEqual(d.target, { start: "node src/server.mjs", port: 3000, cwd: "." });
});

test("detect: falls back to `main` when no direct start", () => {
  const d = detectProject(tmp({ main: "index.js" }));
  assert.equal(d.target?.start, "node index.js");
});

test("detect: npm-wrapped start is not auto-set (needs direct node for IPC)", () => {
  const d = detectProject(tmp({ scripts: { start: "next start" } }));
  assert.equal(d.target, null);
  assert.match(d.note, /forge target set/);
});

test("detect: no package.json → no target", () => {
  const d = detectProject(tmp(null));
  assert.equal(d.kind, "unknown");
  assert.equal(d.target, null);
});
