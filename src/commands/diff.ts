// `forge diff <run-id>` — see docs/05-CLI-UX-SPEC.md.

import * as ui from "../core/ui.js";
import { loadRun, listRuns } from "../core/store.js";
import { summarizeDiffs } from "../core/diffFormat.js";

export async function diff(runId: string): Promise<void> {
  const record = loadRun(runId);
  if (!record) {
    ui.errorBox(`run ${runId} not found`, `available runs: ${listRuns().join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const summaries = summarizeDiffs(record.diffs);

  console.log();
  for (let i = 0; i < record.diffs.length; i++) {
    const file = record.diffs[i];
    const summary = summaries[i];
    const tag = summary.status === "added" ? "  (new file)" : "";
    console.log(`  ${file.path} | +${summary.added} -${summary.removed}${tag}`);
    ui.divider(50);

    for (const hunk of file.hunks) {
      let lineNo = hunk.startLine;
      for (const line of hunk.lines) {
        ui.diffLine(line.type, lineNo, line.text);
        if (line.type !== "remove") lineNo += 1;
      }
    }
    console.log();
  }
}
