// The enforcement core of the preload hook. Target-agnostic and free of any
// real monkeypatching, so it is fully unit-testable: each patch (patchPg /
// patchHttp / patchFs) builds an AgentOperation, calls these functions to get a
// policy decision via the real `evaluateOperation`, and then actually forwards
// / mutates / throws based on the result. See docs/09-ENGINE-ARCHITECTURE.md §4.3.

import { evaluateOperation, type PolicyEvalContext } from "../../core/policyEngine.js";
import { toEnforcement } from "../types.js";
import type { AgentOperation, PolicyVerdict, ResolvedPolicy } from "../../types.js";

export interface InterceptDeps {
  policy: ResolvedPolicy;
  ctx: PolicyEvalContext;
  /** report the op + verdict to the parent (over IPC in production). */
  emit: (op: AgentOperation, verdict: PolicyVerdict) => void;
}

/** Marker error thrown into the app when policy blocks an operation. */
export class ForgeBlockedError extends Error {
  constructor(reason: string) {
    super(`[forge] blocked: ${reason}`);
    this.name = "ForgeBlockedError";
  }
}

/**
 * Intercept a DB query: evaluate, report, then forward the (possibly rewritten)
 * SQL to the sandbox, or throw if blocked. `forward` runs the real query
 * against the sandbox database.
 */
export async function interceptDbQuery<T>(
  op: AgentOperation,
  deps: InterceptDeps,
  forward: (sql: string) => Promise<T>
): Promise<T> {
  const verdict = evaluateOperation(op, deps.policy, deps.ctx);
  deps.emit(op, verdict);
  const decision = toEnforcement(verdict);
  if (decision.action === "block") throw new ForgeBlockedError(decision.reason);
  // pass → original sql; rewrite → corrected sql
  return forward(decision.op.sql ?? op.sql ?? "");
}

export interface HttpDecision {
  action: "pass" | "rewrite" | "block";
  host: string;
  /** for rewrite: the mock host the call should be sent to instead. */
  redirectedTo?: string;
  reason?: string;
}

/**
 * Intercept an outbound HTTP connect: evaluate, report, and return where the
 * call should actually go (original host, redirected mock host, or blocked).
 * The http patch dials `redirectedTo` on rewrite, or throws on block.
 */
export function interceptHttpConnect(op: AgentOperation, deps: InterceptDeps): HttpDecision {
  const verdict = evaluateOperation(op, deps.policy, deps.ctx);
  deps.emit(op, verdict);
  const decision = toEnforcement(verdict);
  const host = op.host ?? "";
  if (decision.action === "block") return { action: "block", host, reason: decision.reason };
  if (decision.action === "rewrite") return { action: "rewrite", host, redirectedTo: decision.op.host };
  return { action: "pass", host };
}

/**
 * Intercept a filesystem write: evaluate scope, report, and return whether the
 * write is permitted. The fs patch performs the write (redirected under the FS
 * sandbox) on pass, or throws on block.
 */
export function interceptFsWrite(op: AgentOperation, deps: InterceptDeps): { allowed: boolean; reason?: string } {
  const verdict = evaluateOperation(op, deps.policy, deps.ctx);
  deps.emit(op, verdict);
  if (verdict.verdict === "block") return { allowed: false, reason: verdict.reason };
  return { allowed: true };
}
