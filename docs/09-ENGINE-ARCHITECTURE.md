# Real Engine Architecture (Phase 2–4)

This document specifies the **real** execution engine that replaces v0's fakes.
It is the detailed design behind `08-ROADMAP.md`'s Phases 2–4, scoped to the
decisions taken for the first real cut:

- **Interception:** Node runtime preload (`NODE_OPTIONS=--require forge-hook`).
- **Guard target:** the *executing app + simulation traffic* (not the agent's
  editor process).
- **Sandbox DB:** **Dockerized Postgres**, seeded from the captured schema.
- **Sims:** *real* execution — persona/script traffic against the running app,
  with real assertions (representative sampling for volume).

The scripted v0 path (`forge run`, no Docker) stays as-is for demos/CI. The real
path is `forge run --real`. Both emit the **same** `RunEngineEvents`, so the
TUI, plain renderer, and run report are unchanged.

## 1. What becomes real (the three seams)

| v0 fake | Real replacement |
|---|---|
| `fakeAgent.generateOperations()` — scripted op stream | the **hook** intercepting real `pg`/`http`/`fs` calls |
| `fakeAgent.generateSimResult()` — invented pass/fail | the **sim driver** firing real traffic + asserting |
| `simDb`/`mockApi` — metadata only | real **Docker Postgres** + **mock HTTP server** + **scoped FS** |

Everything else — `policyEngine.evaluateOperation` (pure), `runEngine`'s event
shape, renderers, report/diff/approve lifecycle — is reused.

## 2. Process topology

```
forge run --real  (parent = orchestrator / event aggregator)
   │
   ├─ engine/backends/postgres.ts   docker run postgres:16 → wait healthy → seed(schema)
   ├─ engine/backends/mockServer.ts local http server, canned responses per preset
   ├─ engine/backends/fsSandbox.ts  scoped temp dir for fs writes
   │
   ├─ spawn target app:  NODE_OPTIONS=--require <forge-hook>
   │     env: FORGE_POLICY (resolved), FORGE_DB_URL (sandbox), FORGE_MOCKS, FORGE_SCOPE
   │     hook patches pg/http/fs → evaluateOperation → ENFORCE → IPC op events
   │
   └─ engine/driver/simDriver.ts    persona/script → real HTTP → app → (hook) → assertions
         IPC + driver results → RunEngineEvents → TUI / plain / report → teardown
```

The parent never makes policy decisions for live calls — those happen **inside
the hook**, synchronously, so a rewrite/block actually changes execution. The
parent only *aggregates and displays* the resulting events.

## 3. Module layout (new)

```
src/engine/
  realRun.ts             # orchestrator (parallels core/runEngine.ts; emits same events)
  types.ts               # engine contracts: backends, hook config, IPC messages
  backends/
    postgres.ts          # Docker lifecycle: up → seed(schema) → connectionString → down
    mockServer.ts        # local HTTP server from mockApi presets   (no Docker)
    fsSandbox.ts         # scoped temp dir + path allow-check        (no Docker)
  hook/
    preload.ts           # the --require entry: install patches, open IPC
    patchPg.ts           # intercept pg query/connect → policy + reroute to sandbox
    patchHttp.ts         # intercept http(s).request/fetch → policy + redirect to mock
    patchFs.ts           # intercept fs writes → scope policy + redirect
    ipc.ts               # child → parent message channel
  driver/
    simDriver.ts         # run sims: sessions → requests → assertions → SimResult
    personas.ts          # synthesize a request sequence from persona attributes
examples/
  acme-checkout/         # the sample target app (Express-shaped, intentional edge bug)
```

## 4. Contracts

### 4.1 `AgentOperation` (extended, additive)
Existing fields unchanged. The hook additionally populates:
- `caller?: string` — `file:line` derived from a captured stack trace
- `latencyMs?: number` — sandbox round-trip
- `sandboxTarget?: string` — where the (possibly rewritten) call actually went

### 4.2 Policy — reused verbatim
The hook imports `resolvePolicyRules` + `evaluateOperation` and calls them
in-process. No change to the policy engine. The resolved policy + `ctx`
(scope, readOnly, knownMocks) are passed to the child via env (`FORGE_POLICY`).

### 4.3 Enforcement (new)
```
applyVerdict(callArgs, verdict):
  pass    → forward callArgs to the sandbox backend, return its result
  rewrite → replace callArgs from verdict.rewrittenOperation, forward, return
  block   → throw new Error("[forge] " + verdict.reason)   // app code receives it
```
This is the single most important new behavior: in v0 "block then self-correct"
is scripted; here a block is a *real exception* the app/agent reacts to.

### 4.4 Events — reused
`realRun.ts` emits the identical `RunEngineEvents` (`header`, `file`, `op`,
`sim:start/progress/result`, `stat`, `log`, `done`). Renderers don't know or
care that ops are now real.

## 5. IPC protocol (hook → parent)

Transport: `child_process` IPC (`process.send` / `on("message")`) — JSON,
cross-platform (works on Windows), no sockets/ports.

```ts
type HookMessage =
  | { t: "ready" }                                   // app booted, listening
  | { t: "op"; op: AgentOperation; verdict: PolicyVerdict }
  | { t: "log"; level: "info"|"warn"|"error"; msg: string }
  | { t: "served"; service: string; path: string }; // a mock endpoint was hit
```
The parent maps `op` → `emit("op"|"file"|"stat")`, `log` → `emit("log")`.

## 6. Interception points

### 6.1 Postgres (`patchPg.ts`)
- Patch `Client.prototype.connect` (and `Pool`) to **rewrite the connection
  target** to the sandbox container — prod is never dialed, even on a `pass`.
- Patch `Client.prototype.query` / `Pool.prototype.query`: extract SQL → build
  `AgentOperation{kind:"db_query"}` → `evaluateOperation` → enforce:
  - `pass` → run against sandbox, return rows
  - `rewrite` → swap SQL (e.g. add `WHERE`, strip PII cols), run, return
  - `block` → throw (e.g. wildcard `SELECT *`)
- SQL parsing upgrades from regex to `node-sql-parser` in a later pass; the
  policy engine's contract does not change.

### 6.2 HTTP/HTTPS (`patchHttp.ts`)
- Patch `http.request` / `https.request` and `globalThis.fetch` (undici).
- Inspect host:
  - known third-party **with a registered mock** → rewrite to the mock server
    URL (no TLS MITM, no CA — we swap the target at the library boundary)
  - unmocked external host → `block` (throw)
  - localhost / sandbox → allow
- This is the key advantage of preload over a proxy: **no certificate trust
  setup is ever required.**

### 6.3 Filesystem (`patchFs.ts`)
- Patch `fs.writeFile(Sync)`, `fs.promises.writeFile`, `appendFile`, `rm`.
- Check `path` against the agent's `scope` / `read_only` globs → `block` outside
  scope; allowed writes redirect under the FS sandbox root.

## 7. Backends

### 7.1 Postgres (`backends/postgres.ts`) — needs Docker
```
up():     docker run -d --rm -e POSTGRES_PASSWORD=… -p <ephemeral>:5432 postgres:16
          poll until accepting connections
seed():   CREATE TABLE … from FIXED_SCHEMA; INSERT synthetic rows (reuse simDb)
url():    postgres://postgres:…@127.0.0.1:<port>/postgres
down():   stop container (--rm cleans up)
```
Fresh container (or fresh schema) per run for isolation. If Docker is absent,
`forge run --real` errors with guidance (and may fall back to the scripted run).

### 7.2 Mock server (`backends/mockServer.ts`) — no Docker
A real local `http.createServer` that returns canned, preset-shaped JSON
(`stripe` charge → `{ id, status:"succeeded" }`, a `declined` path, `sendgrid`
capture → `202`). Records every call for the report. Exposes a host→service map
the hook uses for redirection.

### 7.3 FS sandbox (`backends/fsSandbox.ts`) — no Docker
A scoped temp dir; `allows(path)` enforces the agent's globs; redirected writes
land here and are diffable.

## 8. Simulation driver (`driver/simDriver.ts`)

Drives real traffic against the running app:
- **scripted** sims: each `step` → an HTTP call to the mapped route; assert the
  response against `expect` (`status`, `error_code`); `repeat` N (sampled).
- **declarative** personas: synthesize a request sequence from attributes
  (`cart_size`, `payment_method`, `card_status`, `has_coupon`); fire `sessions`
  (a capped representative sample, with concurrency) and assert structural
  invariants ("no 5xx", "no order without a payment row") plus a mapped subset
  of the free-text `assertions`. Remaining assertions are *displayed*, labelled
  as not-executed.
- Aggregates real pass/fail → `SimResult`. The `failingPersona` /
  `failureReason` **emerge from real failures** (the sample app ships the
  `expired_card + coupon` bug on purpose), so the "edge case caught" story is a
  genuine finding, not a seeded number.

**Volume:** rates are real; displayed session totals may be extrapolated from a
capped sample so a run takes seconds, not minutes (tunable).

## 9. The diff

In v0 the diff is fabricated. In the real engine the "code change" is whatever
the agent wrote: the orchestrator captures `git diff` of the target repo (or a
provided patch) as the `FileDiff[]`. Real, reviewable, tied to the actual run.

## 10. Run modes & fallback

- `forge run` → scripted engine (no Docker, instant) — demos, CI, the TUI story.
- `forge run --real` → real engine. Requires Docker (for the DB) and a Node
  target app declared in `forge.yaml`'s `target:` block (`start`, `port`).
- No Docker present → clear error + offer the scripted run.

## 11. Trust boundary (honest scope)

The preload tier is a **safety net + audit + redirection**, not a jail:
determined/native code can bypass monkeypatching. Because Docker is already in
the stack, a later **hardened mode** runs the app in a container on an isolated
network whose only egress is the mock server — real "cannot reach prod"
containment, same hook, same events. OS/microVM isolation is the long-term tier.

## 12. Build order & what's testable without Docker

| Milestone | Testable without Docker? |
|---|---|
| M1 sample app (`examples/acme-checkout`) | yes (code + routes) |
| M2 hook patches (pg/http/fs) | yes — inject fake `evaluate`/`emit`, assert enforcement |
| M3 mock server, FS sandbox | yes — start server, fetch, assert |
| M3 Postgres backend | **no** — needs Docker |
| M4 orchestrator (`realRun`) | partial — backends faked |
| M5 sim driver | yes against a local app + mock server |

The pure, in-process pieces (hook enforcement, mock server, FS sandbox, driver)
are unit-testable on any machine; only the Postgres backend and a full
end-to-end `--real` run require Docker.
