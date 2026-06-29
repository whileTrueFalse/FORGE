// `forge approve <run-id>` — see docs/05-CLI-UX-SPEC.md.

import * as ui from "../core/ui.js";
import { loadForgeYaml, loadRun, saveRun, listRuns } from "../core/store.js";

interface ApproveOptions {
  force?: boolean;
}

export async function approve(runId: string, options: ApproveOptions): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  const record = loadRun(runId);
  if (!record) {
    ui.errorBox(`run ${runId} not found`, `available runs: ${listRuns().join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const { passRate } = record.report;
  const threshold = config.approve.require_pass_rate;

  console.log();
  console.log(`  ${runId} summary:`);
  console.log(`    sim pass rate:     ${passRate}%   (threshold: ${threshold}%)`);
  console.log(
    `    policy blocks:     ${record.report.policyStats.blocks} (auto-resolved)`
  );
  console.log();

  if (passRate < threshold && !options.force) {
    ui.blocked(`cannot approve: sim pass rate ${passRate}% is below required ${threshold}%`);
    ui.dim("  fix the failing edge case, or re-run with --force to override");
    console.log();
    console.log(`  forge run --task "fix expired card + coupon handling"`);
    process.exitCode = 1;
    return;
  }

  if (passRate < threshold && options.force) {
    ui.warn(`forcing approval despite pass rate ${passRate}% (below ${threshold}% threshold)`);
  }

  record.report.approved = true;
  record.report.approvedAt = new Date().toISOString();
  record.report.approvedForced = passRate < threshold;
  saveRun(record);

  ui.ok(`${runId} approved by you @ ${record.report.approvedAt}`);
  ui.dim(`  recorded in .forge/runs/${runId}.json`);

  if (config.integrations.github) {
    console.log();
    ui.info(
      `github integration connected — would post ${runId} report as a PR check`
    );
    ui.dim("  (simulated only in this prototype — no network call made)");
  }
}
