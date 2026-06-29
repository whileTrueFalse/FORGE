// `forge log --follow` — see docs/05-CLI-UX-SPEC.md.

import * as ui from "../core/ui.js";
import { loadRun, loadState, listRuns } from "../core/store.js";

interface LogOptions {
  follow?: boolean;
  run?: string;
}

export async function log(options: LogOptions): Promise<void> {
  const state = loadState();
  const runId = options.run ?? state.lastRunId;

  if (!runId) {
    const available = listRuns();
    ui.errorBox(
      "no run to show",
      available.length > 0
        ? `available runs: ${available.join(", ")}`
        : "run `forge run` first"
    );
    process.exitCode = 1;
    return;
  }

  const record = loadRun(runId);
  if (!record) {
    ui.errorBox(`run ${runId} not found`, `available runs: ${listRuns().join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log();
  ui.dim(`  streaming ${runId} (replay — no live process in v0)...`);
  console.log();

  for (const event of record.events) {
    if (options.follow) {
      await ui.pace(80, 250);
    }
    const prefix =
      event.level === "ok" ? "✓" : event.level === "warn" ? "⚠" : event.level === "error" ? "✗" : "ℹ";
    console.log(`${prefix} ${event.message}`);
  }
}
