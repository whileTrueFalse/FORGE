#!/usr/bin/env node
// Forge CLI entrypoint. Registers all commands with commander.
// See docs/05-CLI-UX-SPEC.md for exact expected output per command.

import { Command } from "commander";
import { init } from "./commands/init.js";
import { dbLink, dbStatus } from "./commands/db.js";
import { mockAdd, mockList } from "./commands/mock.js";
import { simAdd, simList } from "./commands/sim.js";
import { attach } from "./commands/attach.js";
import { run } from "./commands/run.js";
import { tui } from "./commands/tui.js";
import { log } from "./commands/log.js";
import { diff } from "./commands/diff.js";
import { report } from "./commands/report.js";
import { approve } from "./commands/approve.js";
import { connect, disconnect } from "./commands/connect.js";
import { targetSet, targetShow } from "./commands/target.js";
import { policyShow, policyList, policySet } from "./commands/policy.js";
import { launchShell } from "./shell/launch.js";

const program = new Command();

program
  .name("forge")
  .description("A terminal-based sandbox engine for AI coding agents")
  .version("0.1.0-prototype");

// Bare `forge` (no subcommand) launches the interactive shell.
program.action(async () => {
  await launchShell();
});

program
  .command("init")
  .description("Scaffold forge.yaml for this project")
  .option("--name <name>", "project name")
  .option("--stack <stack>", "stack label")
  .option("--policy <preset>", "policy preset (default|strict)")
  .option("--force", "overwrite an existing forge.yaml")
  .action(init);

const db = program.command("db").description("Manage database connectors");
db.command("link")
  .description("Register a database connector and generate synthetic data")
  .argument("<connectionString>", "connection string, e.g. postgres://localhost:5432/mydb")
  .option("--sim-only", "never copy real data (default behavior in v0)")
  .option("--rows <n>", "total synthetic rows to generate")
  .action(dbLink);
db.command("status")
  .description("Show the linked database connector and schema snapshot")
  .action(dbStatus);

const mock = program.command("mock").description("Manage mock third-party APIs");
mock
  .command("add")
  .description("Register a mock API")
  .argument("<service>", "service name, e.g. stripe")
  .option("--preset <preset>", "preset name (defaults to service name)")
  .action(mockAdd);
mock.command("list").description("List registered mocks").action(mockList);

const sim = program.command("sim").description("Manage simulations");
sim
  .command("add")
  .description("Register a simulation from a YAML file or inline flags")
  .option("--file <path>", "path to a sim YAML file")
  .option("--user-type <type>", "quick-add a single persona")
  .option("--count <n>", "session count for --user-type quick-add")
  .action(simAdd);
sim.command("list").description("List registered simulations").action(simList);

program
  .command("attach")
  .description("Attach an AI agent to the sandbox")
  .argument("<agent>", "agent name, e.g. cursor, claude-code")
  .option("--scope <glob>", "glob the agent may write within (required)")
  .option("--read-only <globs...>", "globs the agent may read but not write")
  .option("--exec <command>", "command this agent runs inside the box (run with `forge run`)")
  .action(attach);

const policy = program.command("policy").description("View or change the policy preset");
policy.command("show").description("Show the current policy").action(policyShow);
policy.command("list").description("List all presets and what they do").action(policyList);
policy
  .command("set")
  .description("Change the policy preset")
  .argument("<preset>", "default | strict | soc2 | hipaa | custom")
  .action(policySet);

const target = program.command("target").description("Configure the app to run for real (--real) runs");
target
  .command("set")
  .description("Set the app start command + port")
  .argument("<start>", 'start command, e.g. "node src/server.mjs"')
  .option("--port <n>", "port the app listens on")
  .option("--cwd <dir>", "directory to launch the app in")
  .option("--ready <path>", "readiness probe path (default /health)")
  .action(targetSet);
target.command("show").description("Show the configured target").action(targetShow);

program
  .command("run")
  .description("Execute the attached agent's task against the sandbox")
  .option("--task <description>", "task description for the run header")
  .option("--policy <preset>", "override the active policy preset for this run")
  .option("--real", "use the real engine (live interception; in-process DB by default)")
  .option("--exec <command>", "run ANY command inside the sandbox box (isolated + intercepted)")
  .option("--db <backend>", "sandbox DB for --real/--exec: pglite (default, no Docker) | docker")
  .option("--sample <n>", "sampled sessions per simulation for real runs")
  .option("--exit-on-block", "exit with non-zero code if a block goes unresolved")
  .action(run);

program
  .command("tui")
  .description("Run the agent against the sandbox in an interactive dashboard")
  .option("--task <description>", "task description for the run header")
  .option("--policy <preset>", "override the active policy preset for this run")
  .option("--exit-on-block", "exit with non-zero code if a block goes unresolved")
  .action(tui);

program
  .command("log")
  .description("Stream or dump a run's event log")
  .option("--follow", "replay with realistic pacing")
  .option("--run <runId>", "target a specific run (defaults to the latest)")
  .action(log);

program
  .command("diff")
  .description("Show the code diff produced by a run")
  .argument("<runId>", "e.g. run-14")
  .action(diff);

program
  .command("report")
  .description("Render a saved run report to the terminal")
  .argument("<runId>", "e.g. run-14")
  .action(report);

program
  .command("approve")
  .description("Approve a run, gating on the configured pass-rate threshold")
  .argument("<runId>", "e.g. run-14")
  .option("--force", "approve despite failing the pass-rate threshold")
  .action(approve);

program
  .command("connect")
  .description("Connect an external CI/CD integration (simulated in v0)")
  .argument("<provider>", "e.g. github")
  .action(connect);

program
  .command("disconnect")
  .description("Disconnect an external integration")
  .argument("<provider>", "e.g. github")
  .action(disconnect);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
