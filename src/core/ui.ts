// Centralized terminal output helpers. See docs/05-CLI-UX-SPEC.md.
// Keep all chalk/boxen/ora usage behind this module so styling stays
// consistent and easy to change in one place.

import chalk from "chalk";
import boxen from "boxen";

const isTTY = Boolean(process.stdout.isTTY);

export function sleep(ms: number): Promise<void> {
  if (!isTTY) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random-feeling but bounded delay, used between streamed log lines. */
export function pace(minMs = 150, maxMs = 600): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return sleep(ms);
}

export function ok(message: string): void {
  console.log(chalk.green("✓"), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow("⚠"), message);
}

export function blocked(message: string): void {
  console.log(chalk.red("✗"), message);
}

export function info(message: string): void {
  console.log(chalk.blue("ℹ"), message);
}

export function dim(message: string): void {
  console.log(chalk.dim(message));
}

export function plain(message: string): void {
  console.log(message);
}

export function heading(message: string): void {
  console.log();
  console.log(chalk.bold(message));
}

export function divider(width = 50): void {
  console.log(chalk.dim("─".repeat(width)));
}

export function runHeader(opts: {
  runId: string;
  agent: string;
  scope: string;
  task: string;
}): void {
  console.log();
  console.log(chalk.dim(`── forge run ${opts.runId} `) + chalk.dim("─".repeat(Math.max(0, 38 - opts.runId.length))));
  console.log(`  ${chalk.dim("agent:")}  ${opts.agent}`);
  console.log(`  ${chalk.dim("scope:")}  ${opts.scope}`);
  console.log(`  ${chalk.dim("task:")}   ${opts.task}`);
  divider();
}

export function box(title: string, lines: string[]): void {
  const content = lines.join("\n");
  console.log(
    boxen(content, {
      title,
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderColor: "magenta",
      borderStyle: "round",
    })
  );
}

export function errorBox(message: string, hint?: string): void {
  console.log();
  console.log(chalk.red("✗"), message);
  if (hint) {
    console.log(chalk.dim(`  ${hint}`));
  }
  console.log();
}

/** Prints a diff line with the appropriate color based on its leading marker. */
export function diffLine(type: "context" | "add" | "remove", lineNo: number | string, text: string): void {
  const num = String(lineNo).padStart(3, " ");
  if (type === "add") {
    console.log(chalk.green(`+ ${num}   ${text}`));
  } else if (type === "remove") {
    console.log(chalk.red(`- ${num}   ${text}`));
  } else {
    console.log(chalk.dim(`  ${num}   ${text}`));
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
