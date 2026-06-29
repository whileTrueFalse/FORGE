// Shared types for the Forge CLI prototype.
// See docs/02-ARCHITECTURE.md, docs/03-FORGE-YAML-SPEC.md,
// docs/06-POLICY-ENGINE-SPEC.md, docs/07-FAKE-AGENT-SPEC.md for the specs
// these types are derived from.

// ── forge.yaml shape ──────────────────────────────────────────────

export type ForgeMode = "sandbox" | "ci" | "cd";

export interface DbConnectorConfig {
  name: string;
  type: "postgres" | "mysql" | "mongodb" | "sqlite" | "unknown";
  schema_from: string;
  sim_rows: number;
  distributions: "auto";
  linked_at: string;
}

export interface MockConfig {
  name: string;
  preset: string;
  scenarios?: string[];
  capture?: boolean;
  added_at: string;
}

export interface SimulationRef {
  name: string;
  file: string;
  sessions: number;
  concurrency?: number;
}

export type PolicyPreset = "default" | "strict" | "soc2" | "hipaa" | "custom";

export interface PolicyRule {
  block?: string;
  require?: string;
  pii_fields?: string[];
}

export interface PolicyConfig {
  preset: PolicyPreset;
  rules: PolicyRule[];
  on_intercept: "rewrite" | "warn" | "block";
  on_block: "notify_agent" | "stop_run";
}

export interface AgentConfig {
  name: string;
  scope: string;
  read_only: string[];
  env: "sandbox";
  attached_at: string;
}

export interface ApproveConfig {
  require_pass_rate: number;
  require_zero_blocks: boolean;
  notify?: string;
  human_approval: boolean;
}

export interface GithubIntegration {
  repo: string;
  on: string;
  post_check: boolean;
  connected_at: string;
}

export interface Integrations {
  github?: GithubIntegration;
  [key: string]: unknown;
}

export interface SessionsConfig {
  mode: "shared" | "isolated" | "isolated-sync";
  conflict_detection: boolean;
  merge_on_approve: boolean;
}

/** How to launch the target app for a real (`--real`) run. */
export interface TargetConfig {
  /** start command, e.g. "node src/server.mjs" (direct node, so IPC works). */
  start: string;
  /** port the app listens on, where the sim driver reaches it. */
  port: number;
  /** working directory to spawn the app in (defaults to project root). */
  cwd?: string;
  /** optional readiness path polled before driving sims (default "/health"). */
  ready?: string;
}

export interface ForgeConfig {
  project: string;
  version: number;
  mode: ForgeMode;
  data: {
    databases: DbConnectorConfig[];
    mocks: MockConfig[];
  };
  simulations: SimulationRef[];
  policy: PolicyConfig;
  agents: AgentConfig[];
  approve: ApproveConfig;
  integrations: Integrations;
  sessions: SessionsConfig;
  /** present once `forge target set` is run; required for `forge run --real`. */
  target?: TargetConfig;
}

// ── fake schema / sim db ──────────────────────────────────────────

export interface DbColumn {
  name: string;
  type: string;
  pii?: boolean;
}

export interface DbTable {
  name: string;
  columns: DbColumn[];
  indexes: number;
}

export interface DbSchema {
  tables: DbTable[];
}

export interface RowCounts {
  totalRows: number;
  perTable: Record<string, number>;
}

// ── mock api presets ──────────────────────────────────────────────

export interface MockApiPreset {
  service: string;
  preset: string;
  scenarios?: string[];
  capture?: boolean;
  description: string;
}

// ── policy engine ──────────────────────────────────────────────────

export type OperationKind = "db_query" | "fs_write" | "http_connect";

export interface AgentOperation {
  id: string;
  kind: OperationKind;
  sql?: string;
  table?: string;
  path?: string;
  host?: string;
  file: string;
}

export type VerdictType = "pass" | "rewrite" | "block" | "warn";

export interface PolicyVerdict {
  operation: AgentOperation;
  verdict: VerdictType;
  reason?: string;
  rewrittenOperation?: AgentOperation;
}

// The concrete checks implemented by core/policyEngine.ts, in spec order
// (see docs/06-POLICY-ENGINE-SPEC.md §"Rule Evaluation Logic").
export type PolicyRuleId =
  | "wildcard_select" // rule 1
  | "destructive" // rule 2
  | "unscoped_mutation" // rule 3
  | "pii_allowlist" // rule 4
  | "fs_scope" // rule 5
  | "http_mock"; // rule 6

/**
 * A policy config with its preset already expanded into a concrete, ordered
 * list of active rule ids. Produced by `resolvePolicyRules`. Kept separate
 * from `PolicyConfig` so the preset→rules expansion lives in one pure place
 * and `evaluateOperation` never re-derives behavior from the preset name.
 */
export interface ResolvedPolicy {
  preset: PolicyPreset;
  activeRules: PolicyRuleId[];
  piiFields: string[];
  onIntercept: "rewrite" | "warn" | "block";
  onBlock: "notify_agent" | "stop_run";
}

// ── diffs ─────────────────────────────────────────────────────────

export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffHunk {
  startLine: number;
  lines: DiffLine[];
}

export type FileChangeStatus = "modified" | "added" | "deleted";

export interface FileDiff {
  path: string;
  status: FileChangeStatus;
  hunks: DiffHunk[];
}

// ── simulations (runtime results) ──────────────────────────────────

export interface SimResult {
  name: string;
  totalSessions: number;
  passedSessions: number;
  failedSessions: number;
  failureReason?: string;
  failingPersona?: string;
  // Carried from the sim YAML for display in the run report. In v0 assertions
  // are shown, not programmatically evaluated (see docs/04-SIM-YAML-SPEC.md).
  assertions?: string[];
  personas?: string[];
}

// ── run records / reports ──────────────────────────────────────────

export interface RunEvent {
  timestamp: string;
  message: string;
  level: "info" | "ok" | "warn" | "error";
}

export interface PolicyStats {
  intercepts: number;
  blocks: number;
  autoResolved: number;
}

export interface RunReport {
  runId: string;
  project: string;
  agent: string;
  scope: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  filesChanged: number;
  policyStats: PolicyStats;
  simResults: SimResult[];
  passRate: number;
  approved: boolean;
  approvedAt?: string;
  approvedForced?: boolean;
}

export interface RunRecord {
  report: RunReport;
  events: RunEvent[];
  diffs: FileDiff[];
  operations: AgentOperation[];
  verdicts: PolicyVerdict[];
}

// ── simulation YAML file shapes (see docs/04-SIM-YAML-SPEC.md) ────

export interface PersonaAttributeRange {
  min: number;
  max: number;
}

export interface PersonaAttributeProbability {
  probability: number;
}

export type PersonaAttributeValue =
  | string
  | number
  | string[]
  | PersonaAttributeRange
  | PersonaAttributeProbability;

export interface Persona {
  type: string;
  weight: number;
  attributes?: Record<string, PersonaAttributeValue>;
}

export interface ScriptStep {
  action: string;
  params?: Record<string, unknown>;
  expect?: {
    status: "success" | "error";
    error_code?: string;
  };
}

export interface ScriptedBlock {
  name: string;
  steps: ScriptStep[];
  repeat: number;
}

export type SimMode = "declarative" | "scripted" | "combined";

export interface SimFile {
  name: string;
  mode: SimMode;
  personas?: Persona[];
  sessions?: number;
  concurrency?: number;
  assertions?: string[];
  steps?: ScriptStep[];
  repeat?: number;
  scripted?: ScriptedBlock[];
}
