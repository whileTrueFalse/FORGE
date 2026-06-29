// Pure policy evaluation logic. No I/O, no randomness, fully testable.
// See docs/06-POLICY-ENGINE-SPEC.md for the rule specification this
// implements.

import type {
  AgentOperation,
  PolicyConfig,
  PolicyPreset,
  PolicyRuleId,
  PolicyVerdict,
  ResolvedPolicy,
} from "../types.js";

const DEFAULT_PII_FIELDS = ["email", "phone", "address", "ssn"];

/**
 * Preset → active rule ids, per the table in docs/06-POLICY-ENGINE-SPEC.md
 * §"Preset → Rule Mapping". `default` omits rule 4 (PII allowlist on explicit
 * selects); `strict` adds it; `soc2`/`hipaa` share `strict`'s rules but flip
 * `on_block` to `stop_run` (handled in `resolvePolicyRules`, not here).
 */
const PRESET_RULES: Record<PolicyPreset, PolicyRuleId[]> = {
  default: ["wildcard_select", "destructive", "unscoped_mutation", "fs_scope", "http_mock"],
  strict: ["wildcard_select", "destructive", "unscoped_mutation", "pii_allowlist", "fs_scope", "http_mock"],
  soc2: ["wildcard_select", "destructive", "unscoped_mutation", "pii_allowlist", "fs_scope", "http_mock"],
  hipaa: ["wildcard_select", "destructive", "unscoped_mutation", "pii_allowlist", "fs_scope", "http_mock"],
  // `custom` falls back to the `default` rule set in v0; fine-grained custom
  // rule selection from the explicit `rules` array is a future extension.
  custom: ["wildcard_select", "destructive", "unscoped_mutation", "fs_scope", "http_mock"],
};

function getPiiFields(policy: PolicyConfig): string[] {
  for (const rule of policy.rules) {
    if (rule.pii_fields) return rule.pii_fields;
  }
  return DEFAULT_PII_FIELDS;
}

/**
 * Expand a `PolicyConfig` (with a preset name) into a concrete `ResolvedPolicy`
 * with an explicit active-rule list. Pure function — keeps preset→rules
 * expansion in one place so `evaluateOperation` never inspects the preset name.
 * See docs/06-POLICY-ENGINE-SPEC.md §"Preset → Rule Mapping".
 */
export function resolvePolicyRules(policy: PolicyConfig): ResolvedPolicy {
  const activeRules = PRESET_RULES[policy.preset] ?? PRESET_RULES.default;
  // soc2/hipaa never auto-continue past a hard block.
  const onBlock = policy.preset === "soc2" || policy.preset === "hipaa" ? "stop_run" : policy.on_block;
  return {
    preset: policy.preset,
    activeRules: [...activeRules],
    piiFields: getPiiFields(policy),
    onIntercept: policy.on_intercept,
    onBlock,
  };
}

/**
 * Rule 1: wildcard SELECT block.
 */
function checkWildcardSelect(op: AgentOperation, piiFields: string[]): PolicyVerdict | null {
  if (op.kind !== "db_query" || !op.sql) return null;
  if (!/select\s+\*/i.test(op.sql)) return null;

  return {
    operation: op,
    verdict: "block",
    reason: `wildcard select exposes PII fields (${piiFields.join(", ")})`,
  };
}

/**
 * Rule 2: destructive statement block (DROP TABLE / TRUNCATE).
 */
function checkDestructiveStatement(op: AgentOperation): PolicyVerdict | null {
  if (op.kind !== "db_query" || !op.sql) return null;
  if (!/drop\s+table/i.test(op.sql) && !/truncate/i.test(op.sql)) return null;

  return {
    operation: op,
    verdict: "block",
    reason: "destructive statement not permitted in sandbox policy",
  };
}

/**
 * Rule 3: unscoped UPDATE/DELETE → rewrite with a scoped WHERE clause.
 */
function checkUnscopedMutation(op: AgentOperation): PolicyVerdict | null {
  if (op.kind !== "db_query" || !op.sql) return null;
  if (!/^\s*(update|delete)/i.test(op.sql)) return null;
  if (/where/i.test(op.sql)) return null;

  const rewrittenSql = `${op.sql.trim()} WHERE id = ? AND user_id = ?`;
  return {
    operation: op,
    verdict: "rewrite",
    reason: "missing WHERE clause — destructive statement would affect all rows",
    rewrittenOperation: { ...op, sql: rewrittenSql },
  };
}

/**
 * Rule 4: PII field allowlist on explicit-column SELECTs.
 * Only active under strict/soc2/hipaa presets (gated by the resolved rule list).
 */
function checkPiiFieldAllowlist(op: AgentOperation, piiFields: string[]): PolicyVerdict | null {
  if (op.kind !== "db_query" || !op.sql) return null;

  const match = op.sql.match(/^\s*select\s+(.+?)\s+from/i);
  if (!match) return null;

  const columns = match[1].split(",").map((c) => c.trim().toLowerCase());
  const piiLower = piiFields.map((f) => f.toLowerCase());
  const exposed = columns.filter((c) => piiLower.includes(c));
  if (exposed.length === 0) return null;
  // A single-row id-scoped lookup is allowed even with PII fields in v0's simple heuristic.
  if (/where\s+id\s*=\s*\?/i.test(op.sql)) return null;

  return {
    operation: op,
    verdict: "rewrite",
    reason: `explicit PII fields selected without row-scoped lookup (${exposed.join(", ")})`,
    rewrittenOperation: op,
  };
}

/**
 * Rule 5: filesystem scope enforcement.
 */
function checkFsScope(
  op: AgentOperation,
  scope: string,
  readOnly: string[]
): PolicyVerdict | null {
  if (op.kind !== "fs_write" || !op.path) return null;

  const scopeRegex = globToRegex(scope);
  const inScope = scopeRegex.test(op.path);
  const inReadOnly = readOnly.some((g) => globToRegex(g).test(op.path!));

  if (inReadOnly) {
    return {
      operation: op,
      verdict: "block",
      reason: `path is read-only for this agent: ${op.path}`,
    };
  }
  if (!inScope) {
    return {
      operation: op,
      verdict: "block",
      reason: `write outside attached scope: ${op.path}`,
    };
  }
  return null;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§DOUBLESTAR§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§DOUBLESTAR§§/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Rule 6: outbound HTTP → redirect to a registered mock, or block if unmocked.
 */
function checkHttpRedirect(
  op: AgentOperation,
  knownMocks: Record<string, string>
): PolicyVerdict | null {
  if (op.kind !== "http_connect" || !op.host) return null;

  const mockTarget = knownMocks[op.host];
  if (mockTarget) {
    return {
      operation: op,
      verdict: "rewrite",
      reason: `redirected to mock: ${mockTarget}`,
      rewrittenOperation: { ...op, host: `forge-mock://${mockTarget}` },
    };
  }

  return {
    operation: op,
    verdict: "block",
    reason: `no mock registered for ${op.host} — register one with 'forge mock add'`,
  };
}

export interface PolicyEvalContext {
  scope: string;
  readOnly: string[];
  /** Map of real third-party hostname -> registered mock service name. */
  knownMocks: Record<string, string>;
}

/**
 * Evaluate a single operation against a resolved policy. Pure function:
 * runs each active rule check in spec order (1 → 6) and returns the first
 * non-pass verdict, or `pass` if nothing fires.
 */
export function evaluateOperation(
  op: AgentOperation,
  policy: ResolvedPolicy,
  ctx: PolicyEvalContext
): PolicyVerdict {
  const active = (id: PolicyRuleId) => policy.activeRules.includes(id);
  const checks: Array<() => PolicyVerdict | null> = [
    () => (active("wildcard_select") ? checkWildcardSelect(op, policy.piiFields) : null),
    () => (active("destructive") ? checkDestructiveStatement(op) : null),
    () => (active("unscoped_mutation") ? checkUnscopedMutation(op) : null),
    () => (active("pii_allowlist") ? checkPiiFieldAllowlist(op, policy.piiFields) : null),
    () => (active("fs_scope") ? checkFsScope(op, ctx.scope, ctx.readOnly) : null),
    () => (active("http_mock") ? checkHttpRedirect(op, ctx.knownMocks) : null),
  ];

  for (const check of checks) {
    const result = check();
    if (result) return result;
  }

  return { operation: op, verdict: "pass" };
}

/** Known real-world hostnames mapped from registered mock service names. */
export const KNOWN_THIRD_PARTY_HOSTS: Record<string, string> = {
  "api.stripe.com": "stripe",
  "api.sendgrid.com": "sendgrid",
  "api.twilio.com": "twilio",
};

export function buildKnownMocksMap(registeredMockNames: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [host, service] of Object.entries(KNOWN_THIRD_PARTY_HOSTS)) {
    if (registeredMockNames.includes(service)) {
      map[host] = service;
    }
  }
  return map;
}
