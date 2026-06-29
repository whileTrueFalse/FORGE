# Fake Agent Spec — `core/fakeAgent.ts`

`fakeAgent` stands in for a real AI coding agent attached via (eventually)
syscall interception. It does not call any real LLM. It is a **deterministic
scripted scenario generator**: given a task description, it returns an
ordered list of `AgentOperation`s that, when run through the policy engine,
tell a consistent, realistic story — matching the checkout-flow narrative
used throughout the diagrams and docs so the whole prototype feels like one
coherent example rather than disconnected fragments.

## Function Signatures

```ts
function generateOperations(task: string, scope: string): AgentOperation[]
function generateFileDiff(operations: AgentOperation[], verdicts: PolicyVerdict[]): FileDiff[]
```

## v0 Behavior: Single Built-In Scenario

For v0, `generateOperations` does **not** need to do real NLP on the `task`
string. It should return the same scripted operation sequence regardless of
input (the task string is only used for display in the run header), unless
specifically asked to branch — see "Future Extension" below. This keeps the
demo deterministic and reliable.

### The Scripted Sequence

Return operations in this exact order (matching `05-CLI-UX-SPEC.md`'s
expected run output):

```ts
[
  {
    id: "op1",
    kind: "db_query",
    sql: "SELECT id, total FROM orders WHERE user_id = ?",
    file: "checkout.service.ts",
  },
  {
    id: "op2",
    kind: "db_query",
    sql: "INSERT INTO orders (user_id, cart_id, total, status) VALUES (?, ?, ?, ?)",
    file: "checkout.service.ts",
  },
  {
    id: "op3",
    kind: "db_query",
    sql: "UPDATE orders SET status = ?",
    file: "checkout.service.ts",
    // policy engine will flag this as "rewrite" (unscoped update)
  },
  {
    id: "op4",
    kind: "db_query",
    sql: "SELECT * FROM users",
    file: "coupon.validator.ts",
    // policy engine will flag this as "block" (wildcard select / PII)
  },
  {
    id: "op5",
    kind: "http_connect",
    host: "api.stripe.com",
    file: "coupon.validator.ts",
    // policy engine will flag this as "rewrite" (redirect to mock)
  },
]
```

### Self-Correction Behavior

After the policy engine returns a `rewrite` or `block` verdict for an
operation, the **runner** (not the policy engine itself) should ask
`fakeAgent` for a corrected follow-up operation via a third function:

```ts
function generateCorrection(originalOp: AgentOperation, verdict: PolicyVerdict): AgentOperation
```

- For `op3` (unscoped UPDATE) → return the rewritten op the policy engine
  already supplied (`verdict.rewrittenOperation`) — the "correction" is just
  accepting the rewrite. Log this as `✓ agent applied rewrite`.
- For `op4` (wildcard SELECT, hard block) → return a **new** operation:
  ```ts
  {
    id: "op4-corrected",
    kind: "db_query",
    sql: "SELECT id, email_hash, tier FROM users WHERE id = ?",
    file: "coupon.validator.ts",
  }
  ```
  This should be re-evaluated by the policy engine and should `pass`. Log as
  `✓ agent rewrote: ...` followed by `✓ agent applied rewrite`.
- For `op5` (http redirect to mock) → accept `verdict.rewrittenOperation`
  the same way as `op3`.

This mirrors the real-world design intent from the project's earlier
brainstorm: policy interceptions are a feedback loop the agent reacts to, not
just a kill switch.

## Diff Generation

`generateFileDiff` should produce **two file changes**, consistent with the
operations above and matching the exact diff content shown in
`05-CLI-UX-SPEC.md`:

1. `src/checkout/checkout.service.ts` — modified, the SELECT/INSERT/UPDATE
   logic, with the UPDATE line shown as changed (before: unscoped, after:
   scoped with `WHERE id = ? AND user_id = ?`).
2. `src/checkout/coupon.validator.ts` — new file, containing the corrected
   SELECT and the Stripe mock call.

Represent each file change as:

```ts
interface FileDiff {
  path: string;
  status: "modified" | "added" | "deleted";
  hunks: DiffHunk[];
}

interface DiffHunk {
  startLine: number;
  lines: Array<{ type: "context" | "add" | "remove"; text: string }>;
}
```

It's fine for the actual line content to be illustrative TypeScript/SQL
(doesn't need to be a real working file) — the goal is a believable, readable
diff, not compilable code. Reuse the literal example content from
`05-CLI-UX-SPEC.md`'s `forge diff` section so the two stay in sync.

## Simulation Result Generation

This logic can live in `core/fakeAgent.ts` or a sibling `core/simRunner.ts`
(architecture doc lists it inline in the runner — either placement is fine,
just keep it as a clearly separated, pure-ish function):

```ts
function generateSimResult(sim: SimulationConfig): SimResult

interface SimResult {
  name: string;
  totalSessions: number;
  passedSessions: number;
  failedSessions: number;
  failureReason?: string;
  failingPersona?: string;
}
```

### Required behavior for the demo narrative to hold

- **The primary declarative sim** (e.g. `checkout-flow`, large session
  count like 12,000) should always resolve to a **high pass rate** (between
  97-99%), with the small remainder attributed to a believable but minor
  cause. This is "the happy path mostly works."
- **At least one sim** (e.g. an `edge-cases` sim with a small session count
  like 500, tied to a named persona like `expired_card_with_coupon`) should
  always resolve to a **meaningfully partial failure** — pick a pass rate in
  the 60-75% range, with `failingPersona` and `failureReason` populated with
  the exact narrative used throughout the docs: persona
  `expired_card_with_coupon`, reason "no error handling for expired card +
  active coupon combination."
- Use a seeded/deterministic random (e.g. a simple LCG seeded by the sim name
  string, or just fixed numbers with a small ± jitter) so re-running the demo
  produces consistent, repeatable-feeling output rather than wildly different
  numbers each time — this matters for anyone reading the run report later
  and comparing it to the docs.

## Why the Built-In Scenario Is Fixed, Not Generated

Keeping v0 to a single deterministic scripted scenario (rather than trying to
generate varied scenarios from arbitrary task strings) is intentional:

- The whole point of the prototype is to validate the **CLI lifecycle and
  artifact shapes** (live log → diff → sim results → report → approval),
  not to demonstrate AI-task-understanding.
- A fixed, well-crafted scenario can be tuned once to read convincingly and
  stay that way, rather than producing inconsistent or nonsensical output
  for arbitrary input.
- This keeps the surface area small enough that Claude Code (or any
  implementer) can build and verify it quickly, and leaves an obvious,
  well-isolated seam (`generateOperations`) to swap in real agent
  integration later without touching anything else in the system.

## Future Extension (Not v0 Scope — For Reference Only)

A later phase could add a small library of 2-3 alternate scripted scenarios
(e.g. "add rate limiting," "refactor auth flow") selected by simple keyword
matching against the `task` string, each with its own operations/diff/sim
results — same pattern, just more entries. Document this here so it's an
obvious next step, but do not build it in v0.
