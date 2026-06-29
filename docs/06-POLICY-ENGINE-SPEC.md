# Policy Engine Spec

`core/policyEngine.ts` evaluates a single `AgentOperation` against the active
`PolicyConfig` and returns a `PolicyVerdict`. It must be a pure function (no
I/O, no randomness) so it's easy to unit test and easy to later swap for a
real implementation without touching the runner or CLI.

## Types (also belongs in `src/types.ts`)

```ts
type OperationKind = "db_query" | "fs_write" | "http_connect";

interface AgentOperation {
  id: string;
  kind: OperationKind;
  // for db_query:
  sql?: string;
  table?: string;
  // for fs_write:
  path?: string;
  // for http_connect:
  host?: string;
  file?: string;        // which "file the agent is writing" this op belongs to, for grouping in logs
}

type VerdictType = "pass" | "rewrite" | "block";

interface PolicyVerdict {
  operation: AgentOperation;
  verdict: VerdictType;
  reason?: string;          // required when verdict !== "pass"
  rewrittenOperation?: AgentOperation;  // required when verdict === "rewrite"
}

interface PolicyRule {
  block?: string;            // e.g. "SELECT *", "DROP TABLE", "TRUNCATE"
  require?: string;          // e.g. "WHERE on UPDATE/DELETE", "auth on /api/**"
  pii_fields?: string[];
}

interface PolicyConfig {
  preset: "default" | "strict" | "soc2" | "hipaa" | "custom";
  rules: PolicyRule[];
  on_intercept: "rewrite" | "warn" | "block";
  on_block: "notify_agent" | "stop_run";
}
```

## Rule Evaluation Logic (v0 scope)

Implement these concrete checks. Each maps to one or more `PolicyRule`
entries that a preset enables by default. Use simple string/regex matching
against `operation.sql` — this does not need a real SQL parser for v0.

### 1. Wildcard SELECT block
- **Trigger:** `sql` matches `/select\s+\*/i`.
- **Verdict:** `block`.
- **Reason:** `"wildcard select exposes PII fields (" + piiFields.join(", ") + ")"`.
- **Agent self-correction (handled in `fakeAgent.ts`, not the policy engine
  itself):** the scripted agent should follow a block on `SELECT *` with a
  corrected operation selecting only an explicit allowlist of fields
  (id + non-PII fields), which on re-evaluation should `pass`.

### 2. Destructive statement block
- **Trigger:** `sql` matches `/drop\s+table/i` or `/truncate/i`.
- **Verdict:** `block`.
- **Reason:** `"destructive statement not permitted in sandbox policy"`.
- No auto-rewrite is meaningful here — in v0's scripted scenario, the fake
  agent should simply not attempt this op in the default task (reserve it for
  a possible "stress test" alternate task if one is added later).

### 3. Unscoped UPDATE/DELETE → rewrite
- **Trigger:** `sql` matches `/^(update|delete)/i` AND does **not** contain
  `/where/i`.
- **Verdict:** `rewrite`.
- **Reason:** `"missing WHERE clause — destructive statement would affect all rows"`.
- **Rewrite:** append a plausible scoped condition, e.g. turn
  `UPDATE orders SET status = ?` into
  `UPDATE orders SET status = ? WHERE id = ? AND user_id = ?`. This can be
  template-based in v0 (string concatenation), not real SQL rewriting.

### 4. PII field allowlist on SELECT
- **Trigger:** `sql` is a `SELECT` naming specific columns, and any named
  column is in `policy.rules[].pii_fields` (e.g. `email`, `phone`, `address`,
  `ssn`) **and** the table is not explicitly an auth/identity table the
  policy designates as exempt (v0 can skip the exemption nuance — simpler
  rule: any direct PII field selection outside of a `WHERE id = ?`-scoped,
  single-row lookup is flagged).
- **Verdict:** `warn` (becomes `rewrite` under `on_intercept: rewrite`, the
  default) — same shape as rule 1 but for explicit-column queries, not just
  `SELECT *`.
- This rule mostly exists for `strict`/`soc2`/`hipaa` presets; `default`
  preset can leave this off and rely on rule 1 alone for the v0 demo
  scenario, to keep the scripted narrative clean. Document the rule fully
  here so `strict` mode has somewhere to point.

### 5. Filesystem scope enforcement
- **Trigger:** `operation.kind === "fs_write"` and `operation.path` does not
  match the attached agent's `scope` glob, OR matches one of its
  `read_only` globs.
- **Verdict:** `block`.
- **Reason:** `"write outside attached scope: " + path` (or `"path is read-only for this agent"`).
- No rewrite possible — this should not occur in the default v0 scripted
  scenario (the fake agent should only ever attempt writes inside its
  attached scope) but the rule must exist and be documented so it's testable
  in isolation, and so a future "agent goes rogue" demo scenario can exercise
  it.

### 6. Outbound HTTP → mock redirection
- **Trigger:** `operation.kind === "http_connect"` and `operation.host`
  matches a known real third-party domain that has a registered mock
  (e.g. `api.stripe.com` when a `stripe` mock is registered).
- **Verdict:** `rewrite`.
- **Reason:** `"redirected to mock: " + mockServiceName`.
- **Rewrite:** same operation with `host` replaced by the mock's local
  label (e.g. `forge-mock://stripe`).
- If a host has **no** registered mock, treat as `block` with reason
  `"no mock registered for " + host + " — register one with 'forge mock add'"`.

## Preset → Rule Mapping

| Preset | Active rules |
|---|---|
| `default` | 1 (wildcard select), 2 (destructive), 3 (unscoped update/delete), 5 (fs scope), 6 (http→mock) |
| `strict` | all of `default` + 4 (PII field allowlist on explicit selects) |
| `soc2` | same as `strict`, plus `on_block: stop_run` instead of `notify_agent` (no auto-continue past a hard block) |
| `hipaa` | same as `soc2`; documented separately mainly so `forge.yaml` examples can reference it meaningfully — no additional v0 rule logic required beyond `soc2`'s |

`core/policyEngine.ts` should take the resolved rule list (already expanded
from the preset, by `core/store.ts` or a small helper) rather than
re-deriving it from the preset name inline — keep preset→rules expansion as
its own small pure function, e.g. `resolvePolicyRules(config: PolicyConfig): ResolvedRule[]`.

## Function Signature

```ts
function evaluateOperation(
  op: AgentOperation,
  policy: PolicyConfig
): PolicyVerdict
```

Implementation should run each applicable rule check in the order listed
above (1 → 6) and return on the first non-`pass` verdict. If no rule fires,
return `{ operation: op, verdict: "pass" }`.

## Worked Examples (for tests)

```ts
// 1. Should pass
evaluateOperation(
  { id: "op1", kind: "db_query", sql: "SELECT id, total FROM orders WHERE user_id = ?", file: "checkout.service.ts" },
  defaultPolicy
)
// → { verdict: "pass" }

// 2. Should rewrite (unscoped UPDATE)
evaluateOperation(
  { id: "op2", kind: "db_query", sql: "UPDATE orders SET status = ?", file: "checkout.service.ts" },
  defaultPolicy
)
// → { verdict: "rewrite", reason: "missing WHERE clause...", rewrittenOperation: { ...sql: "UPDATE orders SET status = ? WHERE id = ? AND user_id = ?" } }

// 3. Should block (wildcard select)
evaluateOperation(
  { id: "op3", kind: "db_query", sql: "SELECT * FROM users", file: "coupon.validator.ts" },
  defaultPolicy
)
// → { verdict: "block", reason: "wildcard select exposes PII fields (email, phone, address, ssn)" }
```

These three should be implemented as actual unit tests if a test runner is
set up (not required for v0, but structure the policy engine so it's trivial
to add `node --test` or `vitest` later without refactoring).
