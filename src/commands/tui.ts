// `forge tui` — run the attached agent against the sandbox inside an
// interactive, multi-panel dashboard. Opt-in alternative to `forge run`'s
// line-by-line output; both share the same RunEngine. Requires a TTY.

import * as ui from "../core/ui.js";
import { loadForgeYaml, loadState, nextRunId, saveRun, saveDiffPatch } from "../core/store.js";
import { buildPatchText } from "../core/diffFormat.js";
import { launchTui } from "../tui/launch.js";
import type { PolicyPreset } from "../types.js";

interface TuiOptions {
  task?: string;
  policy?: string;
  exitOnBlock?: boolean;
}

const VALID_PRESETS: PolicyPreset[] = ["default", "strict", "soc2", "hipaa", "custom"];

export async function tui(options: TuiOptions): Promise<void> {
  if (!process.stdout.isTTY) {
    ui.errorBox("forge tui requires an interactive terminal", "use `forge run` for plain / CI output");
    process.exitCode = 1;
    return;
  }

  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  const state = loadState();
  if (!state.attachedAgent || config.agents.length === 0) {
    ui.errorBox("no agent attached", "run `forge attach <agent> --scope <glob>` first");
    process.exitCode = 1;
    return;
  }

  if (options.policy) {
    if (!VALID_PRESETS.includes(options.policy as PolicyPreset)) {
      ui.errorBox(`unknown policy preset: ${options.policy}`, `valid presets: ${VALID_PRESETS.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    config.policy.preset = options.policy as PolicyPreset;
  }

  const agent = config.agents[0];
  const task = options.task ?? "add coupon validation to checkout";
  const runId = nextRunId();

  const outcome = await launchTui({
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
