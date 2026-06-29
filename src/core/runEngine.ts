// Event-driven run engine. Holds ALL of `forge run`'s computation (policy
// evaluation, agent self-correction, simulation results, report assembly) and
// emits typed events as it goes — but does no terminal output itself.
//
// Two consumers attach to it: core/plainRenderer.ts (the line-by-line CLI
// output, preserving the original `forge run` UX) and the Ink dashboard under
// src/tui/. This keeps one source of truth for run behavior while supporting
// multiple front-ends. See docs/02-ARCHITECTURE.md §5 for the sequence.

import { EventEmitter } from "node:events";
import yaml from "js-yaml";
import { sleep, pace } from "./ui.js";
import { loadSimFile } from "./store.js";
import { evaluateOperation, buildKnownMocksMap, resolvePolicyRules } from "./policyEngine.js";
import { generateOperations, generateCorrection, generateFileDiff, generateSimResult } from "./fakeAgent.js";
import type {
  AgentConfig,
  AgentOperation,
  ForgeConfig,
  PolicyStats,
  PolicyVerdict,
  RunEvent,
  RunRecord,
  SimFile,
  SimResult,
  SimulationRef,
} from "../types.js";

export interface RunOptions {
  runId: string;
  task: string;
  agent: AgentConfig;
  config: ForgeConfig;
  exitOnBlock: boolean;
}

export interface RunOutcome {
  record: RunRecord;
  hadUnresolvedBlock: boolean;
}

export type OpStatus = "pass" | "rewrite" | "block";

/** One fully-resolved operation: its verdict and any agent self-correction. */
export interface OpEvent {
  op: AgentOperation;
  status: OpStatus;
  reason?: string;
  rewritten?: AgentOperation; // for rewrite (and http redirect)
  corrected?: AgentOperation; // for a hard block that the agent retried
  correctedPassed?: boolean; // whether the retry cleared policy
  stopped?: boolean; // block under on_block: stop_run halted the run
}

export interface HeaderInfo {
  runId: string;
  project: string;
  mode: string;
  agent: string;
  scope: string;
  task: string;
}

// Typed event map for the engine.
export interface RunEngineEvents {
  header: [HeaderInfo];
  file: [{ file: string }];
  op: [OpEvent];
  "sim:start": [{ name: string; sessions: number }];
  "sim:progress": [{ name: string; count: number; total: number }];
  "sim:result": [{ result: SimResult }];
  stat: [PolicyStats];
  log: [RunEvent];
  done: [RunOutcome];
}

/**
 * The minimal interface the dashboard/renderers consume. Both the scripted
 * `RunEngine` and the real `RealRunEngine` satisfy it, so the same UI drives
 * either a fake or a real run.
 */
export interface RunSource {
  on<K extends keyof RunEngineEvents>(event: K, listener: (...args: RunEngineEvents[K]) => void): this;
  run(): Promise<RunOutcome>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function loadSimMeta(sim: SimulationRef): { assertions?: string[]; personas?: string[] } {
  try {
    const parsed = yaml.load(loadSimFile(sim.file)) as SimFile;
    return { assertions: parsed.assertions, personas: parsed.personas?.map((p) => p.type) };
  } catch {
    return {};
  }
}

export class RunEngine extends EventEmitter {
  // Typed overrides so consumers get autocompletion on event names/payloads.
  override on<K extends keyof RunEngineEvents>(event: K, listener: (...args: RunEngineEvents[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override emit<K extends keyof RunEngineEvents>(event: K, ...args: RunEngineEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  constructor(private readonly opts: RunOptions) {
    super();
  }

  async run(): Promise<RunOutcome> {
    const { runId, task, agent, config } = this.opts;
    const events: RunEvent[] = [];
    const allVerdicts: PolicyVerdict[] = [];
    const allOperations: AgentOperation[] = [];

    const log = (level: RunEvent["level"], message: string) => {
      const e: RunEvent = { timestamp: nowIso(), level, message };
      events.push(e);
      this.emit("log", e);
    };

    const startedAt = nowIso();
    this.emit("header", {
      runId,
      project: config.project,
      mode: config.mode,
      agent: agent.name,
      scope: agent.scope,
      task,
    });
    log("info", `run ${runId} started`);

    const knownMocks = buildKnownMocksMap(config.data.mocks.map((m) => m.name));
    const ctx = { scope: agent.scope, readOnly: agent.read_only, knownMocks };
    const resolvedPolicy = resolvePolicyRules(config.policy);

    const stats: PolicyStats = { intercepts: 0, blocks: 0, autoResolved: 0 };
    const emitStats = () => this.emit("stat", { ...stats });
    let unresolvedBlock = false;
    let currentFile = "";

    const ops = generateOperations(task, agent.scope);

    for (const op of ops) {
      if (op.file !== currentFile) {
        currentFile = op.file;
        this.emit("file", { file: currentFile });
        log("info", `agent writing: ${currentFile}`);
      }

      allOperations.push(op);
      const verdict = evaluateOperation(op, resolvedPolicy, ctx);
      allVerdicts.push(verdict);
      await pace();

      if (verdict.verdict === "pass") {
        this.emit("op", { op, status: "pass" });
        log("ok", `${describeOp(op)} [pass]`);
        continue;
      }

      if (verdict.verdict === "rewrite") {
        stats.intercepts += 1;
        const rewritten = verdict.rewrittenOperation ?? op;
        log("warn", `${describeOp(op)} — ${verdict.reason}`);
        await pace(100, 300);
        stats.autoResolved += 1;
        log("ok", "agent applied rewrite");
        this.emit("op", { op, status: "rewrite", reason: verdict.reason, rewritten });
        emitStats();
        await pace(100, 300);
        continue;
      }

      // block
      stats.blocks += 1;
      log("error", `BLOCKED: ${describeOp(op)} — ${verdict.reason}`);
      await pace(100, 300);

      if (resolvedPolicy.onBlock === "stop_run") {
        unresolvedBlock = true;
        log("error", "run stopped: on_block=stop_run");
        this.emit("op", { op, status: "block", reason: verdict.reason, stopped: true });
        emitStats();
        break;
      }

      const corrected = generateCorrection(op, verdict);
      allOperations.push(corrected);
      const correctedVerdict = evaluateOperation(corrected, resolvedPolicy, ctx);
      allVerdicts.push(correctedVerdict);
      const correctedPassed = correctedVerdict.verdict === "pass";
      if (correctedPassed) {
        stats.autoResolved += 1;
        log("ok", "agent applied rewrite (post-block correction)");
      } else {
        unresolvedBlock = true;
        log("error", "agent correction still failed policy — unresolved");
      }
      this.emit("op", { op, status: "block", reason: verdict.reason, corrected, correctedPassed });
      emitStats();
      await pace(100, 300);
    }
    emitStats();

    // ── simulations ──────────────────────────────────────────────────
    const simResults: SimResult[] = [];
    for (const sim of config.simulations) {
      this.emit("sim:start", { name: sim.name, sessions: sim.sessions });
      log("info", `running simulation: ${sim.name}`);
      await this.paceSim(sim.name, sim.sessions);

      const result = generateSimResult(sim);
      Object.assign(result, loadSimMeta(sim));
      simResults.push(result);
      this.emit("sim:result", { result });

      const passRate = (result.passedSessions / result.totalSessions) * 100;
      if (passRate >= 95) {
        log("ok", `${sim.name}: ${result.passedSessions}/${result.totalSessions} passed`);
      } else {
        log(
          "warn",
          `${sim.name}: ${result.failedSessions} failed (${result.failingPersona}) — ${result.failureReason}`
        );
      }
    }

    // ── assemble report ──────────────────────────────────────────────
    const diffs = generateFileDiff();
    const perSimRates = simResults.map((r) => (r.passedSessions / r.totalSessions) * 100);
    const passRate =
      perSimRates.length > 0
        ? Math.round((perSimRates.reduce((a, b) => a + b, 0) / perSimRates.length) * 10) / 10
        : 100;

    const record: RunRecord = {
      report: {
        runId,
        project: config.project,
        agent: agent.name,
        scope: agent.scope,
        task,
        startedAt,
        finishedAt: nowIso(),
        filesChanged: diffs.length,
        policyStats: { ...stats },
        simResults,
        passRate,
        approved: false,
      },
      events,
      diffs,
      operations: allOperations,
      verdicts: allVerdicts,
    };

    const outcome: RunOutcome = { record, hadUnresolvedBlock: unresolvedBlock };
    this.emit("done", outcome);
    return outcome;
  }

  private async paceSim(name: string, totalSessions: number): Promise<void> {
    if (totalSessions < 2000) {
      await sleep(300);
      return;
    }
    for (const fraction of [0.25, 0.7]) {
      await sleep(250);
      this.emit("sim:progress", {
        name,
        count: Math.round(totalSessions * fraction),
        total: totalSessions,
      });
    }
    await sleep(250);
  }
}

export function describeOp(op: AgentOperation): string {
  if (op.kind === "db_query") return op.sql ?? "(query)";
  if (op.kind === "fs_write") return `write ${op.path}`;
  if (op.kind === "http_connect") return `connect → ${op.host}`;
  return "(operation)";
}
