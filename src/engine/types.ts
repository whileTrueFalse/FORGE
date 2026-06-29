// Contracts for the real execution engine (see docs/09-ENGINE-ARCHITECTURE.md).
// These interfaces are what the orchestrator, hook, backends, and sim driver
// implement. They deliberately reuse the existing policy + operation types so
// the pure policy engine and the event/report pipeline are shared with v0.

import type { AgentOperation, DbSchema, PolicyVerdict, ResolvedPolicy } from "../types.js";

// ── sandbox backends ───────────────────────────────────────────────

/** A seeded sandbox database the app's queries are rerouted to. */
export interface DbBackend {
  /** Connection string the hook points the app's pg client at. */
  connectionString(): string;
  /** Create schema + synthetic rows from the captured schema shape. */
  seed(schema: DbSchema, totalRows: number): Promise<void>;
  /** Tear down (stop container / drop schema). */
  teardown(): Promise<void>;
}

/** A local mock server standing in for third-party APIs (Stripe, SendGrid…). */
export interface MockServerHandle {
  url: string;
  port: number;
  /** real third-party host → registered service name (for hook redirection). */
  serviceForHost: Record<string, string>;
  /** every call the app made to the mock, for the run report. */
  calls: MockCall[];
  close(): Promise<void>;
}

export interface MockCall {
  service: string;
  method: string;
  path: string;
  at: string;
}

/** A scoped filesystem the agent's writes are confined/redirected to. */
export interface FsSandbox {
  root: string;
  /** whether a write to `path` is permitted by the agent's scope. */
  allows(path: string): boolean;
  teardown(): Promise<void>;
}

// ── hook configuration (parent → child via env) ────────────────────

/** Serialized into FORGE_* env vars and read by the preload hook. */
export interface HookConfig {
  policy: ResolvedPolicy;
  scope: string;
  readOnly: string[];
  /** real third-party host → mock server URL to redirect to. */
  hostRedirects: Record<string, string>;
  /** registered mock service names (for "is this host mocked" checks). */
  mocks: string[];
  /** sandbox database connection string the app should actually use. */
  dbUrl: string;
}

// ── IPC: hook (child) → orchestrator (parent) ──────────────────────

export type HookMessage =
  | { t: "ready" }
  | { t: "op"; op: AgentOperation; verdict: PolicyVerdict }
  | { t: "log"; level: "info" | "warn" | "error"; msg: string }
  | { t: "served"; service: string; path: string };

// ── enforcement ────────────────────────────────────────────────────

export type EnforcementAction =
  | { action: "pass"; op: AgentOperation }
  | { action: "rewrite"; op: AgentOperation; reason: string }
  | { action: "block"; reason: string };

/**
 * Map a policy verdict to a concrete enforcement action. Pure — the patch
 * functions call this, then actually forward/mutate/throw based on the result.
 */
export function toEnforcement(verdict: PolicyVerdict): EnforcementAction {
  if (verdict.verdict === "pass") return { action: "pass", op: verdict.operation };
  if (verdict.verdict === "block") return { action: "block", reason: verdict.reason ?? "blocked by policy" };
  // rewrite / warn → rewrite (apply the corrected op, or the original if none)
  return {
    action: "rewrite",
    op: verdict.rewrittenOperation ?? verdict.operation,
    reason: verdict.reason ?? "rewritten by policy",
  };
}

// ── orchestrator options ───────────────────────────────────────────

export interface RealRunOptions {
  runId: string;
  task: string;
  /** how to start the target app (from forge.yaml `target:`). */
  target: { start: string; port: number; cwd?: string };
  /** sampled session cap per sim so a run takes seconds, not minutes. */
  sessionSampleCap?: number;
}
