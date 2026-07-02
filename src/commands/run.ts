// `forge run` — see docs/05-CLI-UX-SPEC.md.

import * as ui from "../core/ui.js";
import { loadForgeYaml, loadState, nextRunId, saveRun, saveDiffPatch } from "../core/store.js";
import { executeRun } from "../core/runner.js";
import { attachPlainRenderer } from "../core/plainRenderer.js";
import { buildPatchText } from "../core/diffFormat.js";
import { RealRunEngine } from "../engine/realRun.js";
import { dockerAvailable } from "../engine/backends/postgres.js";
import type { PolicyPreset } from "../types.js";

interface RunOptions {
  task?: string;
  policy?: string;
  exitOnBlock?: boolean;
  real?: boolean;
  sample?: string;
  db?: string;
}

const VALID_PRESETS: PolicyPreset[] = ["default", "strict", "soc2", "hipaa", "custom"];

export async function run(options: RunOptions): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  const state = loadState();
  if (!state.attachedAgent || config.agents.length === 0) {
    ui.errorBox(
      "no agent attached",
      "run `forge attach <agent> --scope <glob>` first"
    );
    process.exitCode = 1;
    return;
  }

  // Per-run policy override (does not mutate forge.yaml on disk).
  if (options.policy) {
    if (!VALID_PRESETS.includes(options.policy as PolicyPreset)) {
      ui.errorBox(
        `unknown policy preset: ${options.policy}`,
        `valid presets: ${VALID_PRESETS.join(", ")}`
      );
      process.exitCode = 1;
      return;
    }
    config.policy.preset = options.policy as PolicyPreset;
    ui.dim(`  policy override: ${options.policy} (this run only)`);
  }

  const agent = config.agents[0];
  const task = options.task ?? "add coupon validation to checkout";
  const runId = nextRunId();

  // ── real engine path (sandbox DB + real interception) ──────────────
  if (options.real) {
    if (!config.target) {
      ui.errorBox("no target app set", "run `forge target set` first (configure the app Forge runs)");
      process.exitCode = 1;
      return;
    }
    const dbBackend = options.db === "docker" ? "docker" : "pglite";
    if (dbBackend === "docker" && !(await dockerAvailable())) {
      ui.errorBox(
        "Docker not available",
        "start Docker, use the default in-process DB (`forge run --real`), or the scripted run (`forge run`)"
      );
      process.exitCode = 1;
      return;
    }
    const engine = new RealRunEngine({
      runId,
      task,
      config,
      dbBackend,
      sampleCap: options.sample ? Number(options.sample) : 50,
    });
    attachPlainRenderer(engine);
    // Surface backend progress (the plain renderer doesn't print log events).
    engine.on("log", (e) => {
      if (e.level === "error") ui.blocked(e.message);
      else if (e.level === "warn") ui.warn(e.message);
      else ui.dim(`  ${e.message}`);
    });
    try {
      const realOutcome = await engine.run();
      saveRun(realOutcome.record);
      saveDiffPatch(runId, buildPatchText(realOutcome.record.diffs));
      if (options.exitOnBlock && realOutcome.hadUnresolvedBlock) process.exitCode = 1;
    } catch (err) {
      ui.errorBox("real run failed", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
    return;
  }

  const outcome = await executeRun({
    runId,
    task,
    agent,
    config,
    exitOnBlock: Boolean(options.exitOnBlock),
  });

  saveRun(outcome.record);
  saveDiffPatch(runId, buildPatchText(outcome.record.diffs));

  if (options.exitOnBlock && outcome.hadUnresolvedBlock) {
    process.exitCode = 1;
  }
}
