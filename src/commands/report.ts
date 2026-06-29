// `forge report <run-id>` — renders a saved run report to the terminal in a
// human-readable form, so a stakeholder can understand a past run without
// reading JSON or re-running anything. Satisfies PRD success criterion #4
// (docs/01-PRD.md §7) and surfaces sim assertions per docs/04-SIM-YAML-SPEC.md.

import chalk from "chalk";
import * as ui from "../core/ui.js";
import { loadForgeYaml, loadRun, listRuns } from "../core/store.js";
import type { SimResult } from "../types.js";

function pct(passed: number, total: number): string {
  if (total === 0) return "100%";
  return `${(Math.round((passed / total) * 1000) / 10).toFixed(1)}%`;
}

function renderSim(sim: SimResult): void {
  const rate = pct(sim.passedSessions, sim.totalSessions);
  const clean = sim.failedSessions === 0 || !sim.failingPersona;
  const marker = clean ? chalk.green("✓") : chalk.yellow("⚠");
  console.log(
    `  ${marker} ${sim.name} — ${sim.passedSessions.toLocaleString()} / ${sim.totalSessions.toLocaleString()} passed (${rate})`
  );
  if (sim.personas && sim.personas.length > 0) {
    console.log(chalk.dim(`      personas: ${sim.personas.join(", ")}`));
  }
  if (!clean) {
    console.log(chalk.dim(`      ${sim.failedSessions.toLocaleString()} failed — persona: ${sim.failingPersona}`));
    console.log(chalk.dim(`      cause: ${sim.failureReason}`));
  }
  if (sim.assertions && sim.assertions.length > 0) {
    console.log(chalk.dim("      assertions (displayed, not evaluated in v0):"));
    for (const a of sim.assertions) {
      console.log(chalk.dim(`        · ${a}`));
    }
  }
}

export async function report(runId: string): Promise<void> {
  const config = loadForgeYaml();
  const record = loadRun(runId);
  if (!record) {
    ui.errorBox(`run ${runId} not found`, `available runs: ${listRuns().join(", ") || "(none)"}`);
    process.exitCode = 1;
    return;
  }

  const r = record.report;
  const threshold = config?.approve.require_pass_rate ?? 95;

  console.log();
  console.log(chalk.bold(`  Run Report — ${r.runId}`));
  ui.divider(50);
  console.log(`  ${chalk.dim("project:")}  ${r.project}`);
  console.log(`  ${chalk.dim("agent:")}    ${r.agent}`);
  console.log(`  ${chalk.dim("scope:")}    ${r.scope}`);
  console.log(`  ${chalk.dim("task:")}     ${r.task}`);
  console.log(`  ${chalk.dim("started:")}  ${r.startedAt}`);
  console.log(`  ${chalk.dim("finished:")} ${r.finishedAt}`);

  console.log();
  console.log(chalk.bold("  Code changes"));
  console.log(`  ${chalk.dim("files changed:")} ${r.filesChanged}`);

  console.log();
  console.log(chalk.bold("  Policy"));
  console.log(`  ${chalk.dim("intercepts:")}    ${r.policyStats.intercepts} (auto-rewritten)`);
  console.log(`  ${chalk.dim("blocks:")}        ${r.policyStats.blocks}`);
  console.log(`  ${chalk.dim("auto-resolved:")} ${r.policyStats.autoResolved}`);

  console.log();
  console.log(chalk.bold("  Simulations"));
  for (const sim of r.simResults) {
    renderSim(sim);
  }

  console.log();
  console.log(chalk.bold("  Verdict"));
  const meets = r.passRate >= threshold;
  const rateColor = meets ? chalk.green : chalk.yellow;
  console.log(`  ${chalk.dim("sim pass rate:")} ${rateColor(`${r.passRate}%`)}  (threshold: ${threshold}%)`);

  if (r.approved) {
    const note = r.approvedForced ? " (forced override)" : "";
    console.log(`  ${chalk.green("✓")} approved${note} @ ${r.approvedAt}`);
  } else if (meets) {
    console.log(`  ${chalk.dim("status:")}        not yet approved — eligible (\`forge approve ${r.runId}\`)`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} not approved — pass rate below threshold`);
    console.log(chalk.dim(`      fix the failing edge case, or \`forge approve ${r.runId} --force\``));
  }
  console.log();
}
