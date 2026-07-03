// Reads/writes forge.yaml and everything under .forge/.
// See docs/02-ARCHITECTURE.md §4 for the contract this module implements.
//
// Paths are computed from a *mutable* project root (default: process.cwd()), so
// the long-lived interactive shell can create and switch between projects
// in-process (e.g. `forge init <name>` scaffolds ./<name>/ and switches to it).

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ForgeConfig, RunRecord } from "../types.js";

let projectRoot = process.cwd();

export function setProjectRoot(dir: string): void {
  projectRoot = path.resolve(dir);
}
export function getProjectRoot(): string {
  return projectRoot;
}

const yamlPath = () => path.join(projectRoot, "forge.yaml");
const forgeDir = () => path.join(projectRoot, ".forge");
const runsDir = () => path.join(forgeDir(), "runs");
const reportsDir = () => path.join(forgeDir(), "reports");
const diffsDir = () => path.join(forgeDir(), "diffs");
const simsDir = () => path.join(forgeDir(), "sims");
const statePath = () => path.join(forgeDir(), "state.json");
const schemaPath = () => path.join(forgeDir(), "schema.json");

export function forgeYamlExists(): boolean {
  return fs.existsSync(yamlPath());
}

export function loadForgeYaml(): ForgeConfig | null {
  if (!forgeYamlExists()) return null;
  return yaml.load(fs.readFileSync(yamlPath(), "utf-8")) as ForgeConfig;
}

export function saveForgeYaml(config: ForgeConfig): void {
  fs.writeFileSync(yamlPath(), yaml.dump(config, { lineWidth: 100, noRefs: true }), "utf-8");
}

export function ensureForgeDirs(): void {
  for (const dir of [forgeDir(), runsDir(), reportsDir(), diffsDir(), simsDir()]) {
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
  if (!fs.existsSync(statePath())) return { ...DEFAULT_STATE };
  return JSON.parse(fs.readFileSync(statePath(), "utf-8")) as ForgeState;
}

export function saveState(state: ForgeState): void {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");
}

export function nextRunId(): string {
  const state = loadState();
  state.runCounter += 1;
  saveState(state);
  return `run-${state.runCounter}`;
}

// ── schema.json ──────────────────────────────────────────────────

export function saveSchema(schema: unknown): void {
  fs.writeFileSync(schemaPath(), JSON.stringify(schema, null, 2), "utf-8");
}

export function loadSchema<T = unknown>(): T | null {
  if (!fs.existsSync(schemaPath())) return null;
  return JSON.parse(fs.readFileSync(schemaPath(), "utf-8")) as T;
}

// ── runs ─────────────────────────────────────────────────────────

export function saveRun(run: RunRecord): void {
  fs.writeFileSync(path.join(runsDir(), `${run.report.runId}.json`), JSON.stringify(run, null, 2), "utf-8");
  fs.writeFileSync(path.join(reportsDir(), `${run.report.runId}.json`), JSON.stringify(run.report, null, 2), "utf-8");
  const state = loadState();
  state.lastRunId = run.report.runId;
  saveState(state);
}

export function loadRun(runId: string): RunRecord | null {
  const runPath = path.join(runsDir(), `${runId}.json`);
  if (!fs.existsSync(runPath)) return null;
  return JSON.parse(fs.readFileSync(runPath, "utf-8")) as RunRecord;
}

export function listRuns(): string[] {
  const dir = runsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort((a, b) => Number(a.replace("run-", "")) - Number(b.replace("run-", "")));
}

export function saveDiffPatch(runId: string, patchText: string): void {
  fs.writeFileSync(path.join(diffsDir(), `${runId}.patch`), patchText, "utf-8");
}

// ── sims ─────────────────────────────────────────────────────────

export function saveSimFile(name: string, contents: string): string {
  const fullPath = path.join(simsDir(), `${name}.yaml`);
  fs.writeFileSync(fullPath, contents, "utf-8");
  return path.relative(projectRoot, fullPath);
}

export function loadSimFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(projectRoot, relativePath), "utf-8");
}
