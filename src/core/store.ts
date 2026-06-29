// Reads/writes forge.yaml and everything under .forge/.
// See docs/02-ARCHITECTURE.md §4 for the contract this module implements.

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ForgeConfig, RunRecord } from "../types.js";

const FORGE_YAML_PATH = path.resolve(process.cwd(), "forge.yaml");
const FORGE_DIR = path.resolve(process.cwd(), ".forge");
const RUNS_DIR = path.join(FORGE_DIR, "runs");
const REPORTS_DIR = path.join(FORGE_DIR, "reports");
const DIFFS_DIR = path.join(FORGE_DIR, "diffs");
const SIMS_DIR = path.join(FORGE_DIR, "sims");
const STATE_PATH = path.join(FORGE_DIR, "state.json");
const SCHEMA_PATH = path.join(FORGE_DIR, "schema.json");

export function forgeYamlExists(): boolean {
  return fs.existsSync(FORGE_YAML_PATH);
}

export function loadForgeYaml(): ForgeConfig | null {
  if (!forgeYamlExists()) return null;
  const raw = fs.readFileSync(FORGE_YAML_PATH, "utf-8");
  return yaml.load(raw) as ForgeConfig;
}

export function saveForgeYaml(config: ForgeConfig): void {
  const raw = yaml.dump(config, { lineWidth: 100, noRefs: true });
  fs.writeFileSync(FORGE_YAML_PATH, raw, "utf-8");
}

export function ensureForgeDirs(): void {
  for (const dir of [FORGE_DIR, RUNS_DIR, REPORTS_DIR, DIFFS_DIR, SIMS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── generic state.json (attached agent, etc.) ──────────────────────

export interface ForgeState {
  attachedAgent?: {
    sessionId: string;
    name: string;
    scope: string;
    readOnly: string[];
    attachedAt: string;
  };
  lastRunId?: string;
  runCounter: number;
}

const DEFAULT_STATE: ForgeState = { runCounter: 0 };

export function loadState(): ForgeState {
  if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
  const raw = fs.readFileSync(STATE_PATH, "utf-8");
  return JSON.parse(raw) as ForgeState;
}

export function saveState(state: ForgeState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function nextRunId(): string {
  const state = loadState();
  state.runCounter += 1;
  saveState(state);
  return `run-${state.runCounter}`;
}

// ── schema.json ──────────────────────────────────────────────────

export function saveSchema(schema: unknown): void {
  fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2), "utf-8");
}

export function loadSchema<T = unknown>(): T | null {
  if (!fs.existsSync(SCHEMA_PATH)) return null;
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8")) as T;
}

// ── runs ─────────────────────────────────────────────────────────

export function saveRun(run: RunRecord): void {
  const runPath = path.join(RUNS_DIR, `${run.report.runId}.json`);
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2), "utf-8");

  const reportPath = path.join(REPORTS_DIR, `${run.report.runId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(run.report, null, 2), "utf-8");

  const state = loadState();
  state.lastRunId = run.report.runId;
  saveState(state);
}

export function loadRun(runId: string): RunRecord | null {
  const runPath = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(runPath)) return null;
  return JSON.parse(fs.readFileSync(runPath, "utf-8")) as RunRecord;
}

export function listRuns(): string[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort((a, b) => {
      const na = Number(a.replace("run-", ""));
      const nb = Number(b.replace("run-", ""));
      return na - nb;
    });
}

export function saveDiffPatch(runId: string, patchText: string): void {
  const diffPath = path.join(DIFFS_DIR, `${runId}.patch`);
  fs.writeFileSync(diffPath, patchText, "utf-8");
}

// ── sims ─────────────────────────────────────────────────────────

export function saveSimFile(name: string, contents: string): string {
  const fileName = `${name}.yaml`;
  const fullPath = path.join(SIMS_DIR, fileName);
  fs.writeFileSync(fullPath, contents, "utf-8");
  return path.relative(process.cwd(), fullPath);
}

export function loadSimFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath, "utf-8");
}

export const paths = {
  FORGE_YAML_PATH,
  FORGE_DIR,
  RUNS_DIR,
  REPORTS_DIR,
  DIFFS_DIR,
  SIMS_DIR,
  STATE_PATH,
  SCHEMA_PATH,
};
