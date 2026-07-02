// Real-run orchestrator. Starts the sandbox backends, spawns the target app
// under the preload hook, drives real sim traffic, and assembles a run record —
// emitting the SAME RunEngineEvents as the scripted engine, so the TUI, plain
// renderer, and report consume a real run unchanged. Backends/spawn/driver are
// injectable so the orchestration is unit-testable without Docker or an app.
// See docs/09-ENGINE-ARCHITECTURE.md.

import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { resolvePolicyRules } from "../core/policyEngine.js";
import { loadSimFile } from "../core/store.js";
import { generateSchema } from "../core/simDb.js";
import { startPostgres } from "./backends/postgres.js";
import { startPglite } from "./backends/pglite.js";
import { startMockServer } from "./backends/mockServer.js";
import { createFsSandbox } from "./backends/fsSandbox.js";
import { driveSim as realDriveSim } from "./driver/simDriver.js";
import { encodeHookConfig } from "./hook/ipc.js";
import type { OpEvent, HeaderInfo, RunEngineEvents } from "../core/runEngine.js";
import type { RunOutcome } from "../core/runEngine.js";
import type { DbBackend, FsSandbox, HookConfig, HookMessage, MockServerHandle } from "./types.js";
import type {
  AgentOperation,
  FileDiff,
  ForgeConfig,
  PolicyStats,
  PolicyVerdict,
  RunEvent,
  RunRecord,
  SimFile,
  SimResult,
  SimulationRef,
  TargetConfig,
} from "../types.js";

const exec = promisify(execFile);
const HOOK_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "hook/preload.js");

export interface AppHandle {
  onMessage(cb: (m: HookMessage) => void): void;
  ready: Promise<void>;
  baseUrl: string;
  kill(): void;
}

export interface RealRunDeps {
  startDb(): Promise<DbBackend>;
  startMock(services: string[]): Promise<MockServerHandle>;
  createFs(scope: string, readOnly: string[]): FsSandbox;
  spawnApp(o: { target: TargetConfig; env: NodeJS.ProcessEnv }): AppHandle;
  driveSim(sim: SimulationRef, simFile: SimFile | null, baseUrl: string, onProgress: (d: number, t: number) => void): Promise<SimResult>;
  captureDiff(cwd: string): Promise<FileDiff[]>;
}

export interface RealRunOptions {
  runId: string;
  task: string;
  config: ForgeConfig;
  exitOnBlock?: boolean;
  sampleCap?: number;
  /** sandbox database: "pglite" (in-process, no Docker) or "docker". Default pglite. */
  dbBackend?: "pglite" | "docker";
}

function verdictToOpEvent(op: AgentOperation, verdict: PolicyVerdict): OpEvent {
  if (verdict.verdict === "rewrite" || verdict.verdict === "warn") {
    return { op, status: "rewrite", reason: verdict.reason, rewritten: verdict.rewrittenOperation };
  }
  if (verdict.verdict === "block") return { op, status: "block", reason: verdict.reason };
  return { op, status: "pass" };
}

function loadSimMeta(sim: SimulationRef): SimFile | null {
  try {
    return yaml.load(loadSimFile(sim.file)) as SimFile;
  } catch {
    return null;
  }
}

export class RealRunEngine extends EventEmitter {
  private deps: RealRunDeps;

  // Typed event surface so RealRunEngine satisfies RunSource (shared with the
  // scripted engine), and so the dashboard gets the same autocompletion.
  override on<K extends keyof RunEngineEvents>(event: K, listener: (...args: RunEngineEvents[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override emit<K extends keyof RunEngineEvents>(event: K, ...args: RunEngineEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  constructor(private opts: RealRunOptions, deps: Partial<RealRunDeps> = {}) {
    super();
    this.deps = {
      startDb: deps.startDb ?? (() => (opts.dbBackend === "docker" ? startPostgres() : startPglite())),
      startMock: deps.startMock ?? ((s) => startMockServer(s)),
      createFs: deps.createFs ?? ((scope, ro) => createFsSandbox(scope, ro)),
      spawnApp: deps.spawnApp ?? defaultSpawnApp,
      driveSim: deps.driveSim ?? ((sim, simFile, baseUrl, onProgress) => realDriveSim(sim, simFile, { baseUrl, sampleCap: opts.sampleCap, onProgress })),
      captureDiff: deps.captureDiff ?? defaultCaptureDiff,
    };
  }

  async run(): Promise<RunOutcome> {
    const { config, runId, task } = this.opts;
    const events: RunEvent[] = [];
    const allOps: AgentOperation[] = [];
    const allVerdicts: PolicyVerdict[] = [];
    const stats: PolicyStats = { intercepts: 0, blocks: 0, autoResolved: 0 };
    const startedAt = new Date().toISOString();
    const agent = config.agents[0];

    const log = (level: RunEvent["level"], message: string) => {
      const e: RunEvent = { timestamp: new Date().toISOString(), level, message };
      events.push(e);
      this.emit("log", e);
    };

    const header: HeaderInfo = { runId, project: config.project, mode: config.mode, agent: agent?.name ?? "app", scope: agent?.scope ?? "**", task };
    this.emit("header", header);
    log("info", `real run ${runId} started`);

    const mockNames = config.data.mocks.map((m) => m.name);
    const simResults: SimResult[] = [];
    let diffs: FileDiff[] = [];
    let currentFile = "";
    let db: DbBackend | undefined;
    let mock: MockServerHandle | undefined;
    let fs: FsSandbox | undefined;
    let app: AppHandle | undefined;

    try {
      // ── backends ──────────────────────────────────────────────────
      log("info", this.opts.dbBackend === "docker" ? "starting sandbox database (Docker — first run may pull the image)…" : "starting sandbox database (pglite, in-process)…");
      db = await this.deps.startDb();
      const schema = generateSchema(db.connectionString());
      log("info", "seeding synthetic data…");
      await db.seed(schema, config.data.databases[0]?.sim_rows ?? 50000);
      log("info", "starting mock server…");
      mock = await this.deps.startMock(mockNames);
      fs = this.deps.createFs(agent?.scope ?? "**", agent?.read_only ?? []);
      log("info", `sandbox ready: db + ${mockNames.length} mock(s)`);

      // ── spawn the app under the hook ────────────────────────────────
      const hookConfig: HookConfig = {
        policy: resolvePolicyRules(config.policy),
        scope: agent?.scope ?? "**",
        readOnly: agent?.read_only ?? [],
        hostRedirects: Object.fromEntries(Object.keys(mock.serviceForHost).map((host) => [host, mock!.url])),
        mocks: mockNames,
        dbUrl: db.connectionString(),
      };
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        // ESM hook → must use --import (not --require) with a file URL.
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(HOOK_PATH).href}`.trim(),
        FORGE_HOOK_CONFIG: encodeHookConfig(hookConfig),
        DATABASE_URL: db.connectionString(),
        PORT: String(config.target!.port),
      };
      log("info", `launching app: ${config.target!.start}`);
      app = this.deps.spawnApp({ target: config.target!, env });

      app.onMessage((m) => {
        if (m.t === "op") {
          allOps.push(m.op);
          allVerdicts.push(m.verdict);
          if (m.op.file !== currentFile) {
            currentFile = m.op.file;
            this.emit("file", { file: currentFile });
          }
          if (m.verdict.verdict === "rewrite" || m.verdict.verdict === "warn") {
            stats.intercepts += 1;
            stats.autoResolved += 1;
          } else if (m.verdict.verdict === "block") {
            stats.blocks += 1;
          }
          this.emit("op", verdictToOpEvent(m.op, m.verdict));
          this.emit("stat", { ...stats });
        } else if (m.t === "log") {
          log(m.level, m.msg);
        }
      });

      log("info", "waiting for the app to be ready…");
      await app.ready;
      log("info", "app ready — driving simulations");

      // ── sims ──────────────────────────────────────────────────────
      for (const sim of config.simulations) {
        this.emit("sim:start", { name: sim.name, sessions: sim.sessions });
        const simFile = loadSimMeta(sim);
        const result = await this.deps.driveSim(sim, simFile, app.baseUrl, (count, total) =>
          this.emit("sim:progress", { name: sim.name, count, total })
        );
        simResults.push(result);
        this.emit("sim:result", { result });
        const rate = (result.passedSessions / result.totalSessions) * 100;
        log(rate >= 95 ? "ok" : "warn", `${sim.name}: ${result.passedSessions}/${result.totalSessions} passed`);
      }

      diffs = await this.deps.captureDiff(config.target?.cwd ?? process.cwd());
    } finally {
      // Always tear down so a Docker container / app process never leaks.
      try {
        app?.kill();
      } catch {
        /* noop */
      }
      if (db) await db.teardown().catch(() => {});
      if (mock) await mock.close().catch(() => {});
      if (fs) await fs.teardown().catch(() => {});
      log("info", "sandbox torn down");
    }

    // ── report ──────────────────────────────────────────────────────
    const perSimRates = simResults.map((r) => (r.passedSessions / r.totalSessions) * 100);
    const passRate = perSimRates.length ? Math.round((perSimRates.reduce((a, b) => a + b, 0) / perSimRates.length) * 10) / 10 : 100;

    const record: RunRecord = {
      report: {
        runId,
        project: config.project,
        agent: agent?.name ?? "app",
        scope: agent?.scope ?? "**",
        task,
        startedAt,
        finishedAt: new Date().toISOString(),
        filesChanged: diffs.length,
        policyStats: { ...stats },
        simResults,
        passRate,
        approved: false,
      },
      events,
      diffs,
      operations: allOps,
      verdicts: allVerdicts,
    };
    const outcome: RunOutcome = { record, hadUnresolvedBlock: stats.blocks > 0 && stats.autoResolved < stats.blocks };
    this.emit("done", outcome);
    return outcome;
  }
}

// ── default real implementations (need Docker / a real app to exercise) ──

function defaultSpawnApp({ target, env }: { target: TargetConfig; env: NodeJS.ProcessEnv }): AppHandle {
  const [cmd, ...args] = target.start.split(" ");
  // Suppress the app's stdout/stderr so it can't corrupt the TUI; ops/logs come
  // back over the IPC channel instead.
  const child = spawn(cmd, args, { cwd: target.cwd ?? process.cwd(), env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const emitter = new EventEmitter();
  child.on("message", (m) => emitter.emit("message", m));
  const baseUrl = `http://127.0.0.1:${target.port}`;
  const readyPath = target.ready ?? "/health";
  const ready = (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`${baseUrl}${readyPath}`);
        if (res.ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("target app did not become ready");
  })();
  return {
    onMessage: (cb) => emitter.on("message", cb),
    ready,
    baseUrl,
    kill: () => child.kill(),
  };
}

async function defaultCaptureDiff(cwd: string): Promise<FileDiff[]> {
  try {
    const { stdout } = await exec("git", ["diff", "--unified=3"], { cwd, maxBuffer: 10 * 1024 * 1024 });
    return parseUnifiedDiff(stdout);
  } catch {
    return [];
  }
}

/** Minimal unified-diff → FileDiff[] parser (best-effort, for `forge diff`). */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let lineNo = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git")) {
      const m = raw.match(/ b\/(\S+)/);
      current = { path: m ? m[1] : "unknown", status: "modified", hunks: [] };
      files.push(current);
    } else if (raw.startsWith("new file")) {
      if (current) current.status = "added";
    } else if (raw.startsWith("deleted file")) {
      if (current) current.status = "deleted";
    } else if (raw.startsWith("@@")) {
      const m = raw.match(/\+(\d+)/);
      lineNo = m ? Number(m[1]) : 0;
      current?.hunks.push({ startLine: lineNo, lines: [] });
    } else if (current && current.hunks.length && (raw.startsWith("+") || raw.startsWith("-") || raw.startsWith(" "))) {
      if (raw.startsWith("+++") || raw.startsWith("---")) continue;
      const hunk = current.hunks[current.hunks.length - 1];
      const type = raw[0] === "+" ? "add" : raw[0] === "-" ? "remove" : "context";
      hunk.lines.push({ type, text: raw.slice(1) });
    }
  }
  return files;
}
