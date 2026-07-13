// Tests the `forge mode` command: toggling guided/free persists shellMode in
// state.json, `forge mode` with no arg reports the current mode, and an unknown
// value is rejected.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMMANDS } from "./registry.js";
import { setProjectRoot, getProjectRoot, loadState } from "../core/store.js";
import type { CommandResult } from "./registry.js";

function modeRun() {
  const cmd = COMMANDS.find((c) => c.name === "mode");
  assert.ok(cmd?.run, "mode command must exist with a handler");
  return cmd.run!;
}
const text = (r: CommandResult) => r.lines.map((l) => l.text).join(" ");

test("forge mode: set free/guided persists; no-arg shows current; bad value rejected", async () => {
  const original = getProjectRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-mode-"));
  try {
    setProjectRoot(dir);
    const run = modeRun();

    const setFree = await run(["free"]);
    assert.equal(setFree.ok, true);
    assert.equal(loadState().shellMode, "free");

    const show = await run([]);
    assert.match(text(show), /free/);

    const setGuided = await run(["guided"]);
    assert.equal(setGuided.ok, true);
    assert.equal(loadState().shellMode, "guided");

    const bad = await run(["bogus"]);
    assert.equal(bad.ok, false);
    assert.match(text(bad), /unknown mode/i);
  } finally {
    setProjectRoot(original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
