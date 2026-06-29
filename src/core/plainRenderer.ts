// Subscribes to a RunEngine and reproduces the original line-by-line
// `forge run` terminal output. This is the non-TUI front-end, used for plain
// terminals, piped output, and CI. See docs/05-CLI-UX-SPEC.md.

import chalk from "chalk";
import * as ui from "./ui.js";
import { describeOp, type RunSource } from "./runEngine.js";
import type { RunRecord } from "../types.js";

const greenCheck = chalk.green("✓");
const dim = (s: string) => chalk.dim(s);

export function attachPlainRenderer(engine: RunSource): void {
  engine.on("header", (h) => {
    ui.runHeader({ runId: h.runId, agent: h.agent, scope: h.scope, task: h.task });
  });

  engine.on("file", ({ file }) => {
    console.log();
    ui.dim(`  agent writing: ${file}`);
  });

  engine.on("op", (e) => {
    const label = describeOp(e.op);
    if (e.status === "pass") {
      console.log(`${greenCheck} ${label}`);
      return;
    }
    if (e.status === "rewrite") {
      ui.warn(label);
      console.log(`   ${dim(`reason: ${e.reason}`)}`);
      if (e.rewritten) console.log(`   ${dim(`rewrite: ${describeOp(e.rewritten)}`)}`);
      ui.ok("agent applied rewrite");
      return;
    }
    // block
    ui.blocked(label);
    console.log(`   ${dim(`reason: ${e.reason}`)}`);
    if (e.stopped) return;
    if (e.corrected) console.log(`   ${dim(`agent rewrote: ${describeOp(e.corrected)}`)}`);
    if (e.correctedPassed) ui.ok("agent applied rewrite");
  });

  engine.on("sim:start", ({ name, sessions }) => {
    console.log();
    ui.dim(`  running simulation: ${name} (${sessions.toLocaleString()} sessions)`);
  });

  engine.on("sim:progress", ({ count, total }) => {
    ui.dim(`  ...${count.toLocaleString()} / ${total.toLocaleString()}`);
  });

  engine.on("sim:result", ({ result }) => {
    const rate = (result.passedSessions / result.totalSessions) * 100;
    const line = `${result.passedSessions.toLocaleString()} / ${result.totalSessions.toLocaleString()} sessions passed`;
    if (rate >= 95) {
      ui.ok(line);
    } else {
      ui.warn(line);
      console.log(`   ${dim(`${result.failedSessions.toLocaleString()} failed — persona: ${result.failingPersona}`)}`);
      console.log(`   ${dim(`cause: ${result.failureReason}`)}`);
    }
  });

  engine.on("done", ({ record }) => printRunSummary(record));
}

function printRunSummary(record: RunRecord): void {
  const r = record.report;
  console.log();
  console.log(
    chalk.dim(`── run ${r.runId} complete `) + chalk.dim("─".repeat(Math.max(0, 33 - r.runId.length)))
  );
  console.log(`  ${chalk.dim("files changed:")}     ${r.filesChanged}`);
  console.log(`  ${chalk.dim("policy intercepts:")} ${r.policyStats.intercepts} (auto-rewritten)`);
  console.log(`  ${chalk.dim("policy blocks:")}     ${r.policyStats.blocks} (auto-rewritten)`);
  console.log(`  ${chalk.dim("sim pass rate:")}     ${r.passRate}%`);

  const failing = r.simResults.find((s) => s.failedSessions > 0 && s.failingPersona);
  if (failing) {
    console.log();
    console.log(`  ${chalk.yellow("⚠")} requires attention: ${failing.failingPersona} edge case unhandled`);
  }

  console.log();
  console.log(`  ${chalk.dim("next steps:")}`);
  console.log(`    forge diff ${r.runId}       view the code changes`);
  console.log(`    forge approve ${r.runId}    approve this run`);
  console.log(chalk.dim("─".repeat(50)));
}
