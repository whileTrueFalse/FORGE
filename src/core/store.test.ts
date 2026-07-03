// Tests the movable project root: the store reads/writes relative to a mutable
// root, so the interactive shell can create + switch projects in-process.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot, getProjectRoot, forgeYamlExists, saveForgeYaml, loadForgeYaml } from "./store.js";
import type { ForgeConfig } from "../types.js";

const minimal = (name: string): ForgeConfig => ({
  project: name, version: 1, mode: "sandbox",
  data: { databases: [], mocks: [] }, simulations: [],
  policy: { preset: "default", rules: [], on_intercept: "rewrite", on_block: "notify_agent" },
  agents: [], approve: { require_pass_rate: 95, require_zero_blocks: false, human_approval: true },
  integrations: {}, sessions: { mode: "isolated", conflict_detection: true, merge_on_approve: true },
});

test("store: setProjectRoot moves where forge.yaml is read/written", () => {
  const original = getProjectRoot();
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "forge-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "forge-b-"));
  try {
    setProjectRoot(a);
    assert.equal(forgeYamlExists(), false);
    saveForgeYaml(minimal("proj-a"));
    assert.equal(forgeYamlExists(), true);
    assert.equal(fs.existsSync(path.join(a, "forge.yaml")), true);
    assert.equal(loadForgeYaml()?.project, "proj-a");

    // switching roots isolates state
    setProjectRoot(b);
    assert.equal(forgeYamlExists(), false);
    setProjectRoot(a);
    assert.equal(loadForgeYaml()?.project, "proj-a");
  } finally {
    setProjectRoot(original); // don't leak global state into other tests
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
