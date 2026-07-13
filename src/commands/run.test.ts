// Free-flow guarantee: `forge run` no longer requires an attached agent. With
// agents:[] the run must complete (using the synthesized full-scope default)
// and record a run, not error out with "no agent attached".

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot, getProjectRoot, ensureForgeDirs, saveForgeYaml, listRuns } from "../core/store.js";
import { run } from "./run.js";
import type { ForgeConfig } from "../types.js";

const noAgentConfig = (name: string): ForgeConfig => ({
  project: name, version: 1, mode: "sandbox",
  data: { databases: [], mocks: [] }, simulations: [],
  policy: { preset: "default", rules: [], on_intercept: "rewrite", on_block: "notify_agent" },
  agents: [], approve: { require_pass_rate: 95, require_zero_blocks: false, human_approval: true },
  integrations: {}, sessions: { mode: "isolated", conflict_detection: true, merge_on_approve: true },
});

test("free-flow: `forge run` with no agent attached still completes + records a run", async () => {
  const original = getProjectRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-ff-"));
  const prevExit = process.exitCode;
  try {
    setProjectRoot(dir);
    ensureForgeDirs();
    saveForgeYaml(noAgentConfig("ff"));
    process.exitCode = 0;
    await run({ task: "add coupon validation" });
    assert.notEqual(process.exitCode, 1, "a missing agent must not fail the run");
    assert.ok(listRuns().length >= 1, "the run should have been recorded");
  } finally {
    setProjectRoot(original);
    process.exitCode = prevExit;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
