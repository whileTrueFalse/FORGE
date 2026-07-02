# Forge

> A terminal-based sandbox engine that sits between an AI coding agent and the
> real world — so an agent's code can run against a **simulated** company
> (synthetic database, mock APIs, scoped filesystem) instead of production,
> with every database/network/file action intercepted, policy-checked, and
> audited before it can have any effect.

Forge ships as a single interactive terminal app (`forge`) plus a scriptable
CLI. It has **two engines** behind the same UI: a deterministic **scripted**
engine for instant, no-infrastructure demos/CI, and a **real** engine that
actually intercepts a live Node app's `pg`/`http`/`fs` calls and redirects them
to a sandboxed Postgres + mock server.

---

## Contents

| | | |
|---|---|---|
| [What is Forge](#what-is-forge) | [Quick Start](#quick-start) | [Two Ways to Run](#two-ways-to-run) |
| [The Interactive Shell](#the-interactive-shell) | [The Real Engine](#the-real-engine) | [Project Structure](#project-structure) |
| [How It Works](#how-it-works) | [Command Reference](#command-reference) | [Configuration](#configuration) |
| [Spec and Design Docs](#spec-and-design-docs) | [Testing](#testing) | [Real vs Simulated](#real-vs-simulated) |
| [Roadmap and Status](#roadmap-and-status) | [For Contributors](#for-contributors) | |

---

## What is Forge

**The problem.** "Vibe coding" — letting AI agents write and run code with
minimal review — is growing, and so are the incidents: agents running
destructive SQL against shared databases, leaking PII with `SELECT *`, calling
real payment/email APIs during experiments, with no audit trail of what the
agent actually did. The root cause: **AI agents operate with production-level
reach inside development-level trust.** There is no execution boundary between
"AI writes code" and "code touches real systems."

**The solution.** Forge is that boundary. It:

1. **Intercepts** the app's operations (`db.query`, `http.request`, `fs.write`).
2. **Redirects** them to simulated equivalents — a synthetic DB seeded from your
   schema shape, local mock APIs (Stripe/SendGrid/…), a scoped filesystem.
3. **Applies a policy engine** that can pass, **rewrite** (auto-fix), or
   **block** an operation (no `SELECT *`, require `WHERE` on `UPDATE/DELETE`, no
   PII leakage, no unmocked outbound calls, no out-of-scope writes).
4. **Runs simulations** — synthetic user journeys against the changed code — to
   surface behavioral bugs before a human reviews.
5. **Produces a run report** (diff + policy log + sim results) gated by an
   **approval** step before anything graduates to CI/CD.

Everything is local-only by default. No prod credentials, no data leaves the
machine; synthetic data is generated from schema *shape*, never copied.

[↑ Contents](#contents)

---

## Quick Start

```bash
git clone <your-repo-url>
cd forge-prototype
npm install
npm run build
npm link        # exposes `forge` globally  (or use: npm run forge -- <args>)

forge           # launches the interactive shell
```

Inside the shell, type `forge` to see live command suggestions, or `forge guide`
for a walkthrough. To drive a full scripted run from scratch:

```bash
mkdir my-project && cd my-project
forge init acme-checkout
forge db link postgres://localhost:5432/acme_prod
forge mock add stripe
forge sim add --user-type expired_card_with_coupon --count 500
forge attach cursor --scope "./src/checkout/**"
forge run            # scripted run → live dashboard, no Docker needed
forge report run-1
forge approve run-1
```

> **Requirements:** Node.js 20.6+ (uses `--import`). **No Docker needed** — the
> real engine defaults to an in-process Postgres (pglite); Docker is optional
> (`--real --db docker`) for closest-to-prod concurrency.

[↑ Contents](#contents)

---

## Two Ways to Run

Forge has one UI over two engines that emit the **same events**, so the
dashboard and report are identical either way:

| | `forge run` (scripted) | `forge run --real` (real) |
|---|---|---|
| **Agent operations** | deterministic built-in scenario | intercepted from a live Node app |
| **Database** | record-count metadata | seeded **Postgres** (in-process pglite, or Docker) |
| **Third-party APIs** | preset metadata | local **mock HTTP server** |
| **Simulations** | seeded pass/fail numbers | real HTTP traffic + assertions |
| **Needs Docker?** | no | **no** (pglite default) · Docker optional |
| **Use it for** | demos, CI, the UX, instant feedback | actually catching real bugs |

Start with scripted to learn the flow; switch to `--real` to point Forge at a
real app.

### The isolation box — run *any* command sandboxed

Beyond the server + simulations flow, Forge is a general **isolation box**: give
it any command and it runs that command inside the sandbox — the app/agent/
script/test doesn't know it's enclosed, and every db/http/fs operation it makes
is intercepted, policy-enforced, and redirected to the sandbox.

```bash
forge box "node script.mjs"      # run any code inside the box
forge box "npm test"             # run your test suite sandboxed
forge run --exec "node migrate.mjs"   # same thing, via run

# …or attach it once, then just `forge run`:
forge attach my-agent --scope "./**" --exec "node agent-task.mjs"
forge run                        # runs the attached command in the box
```

```
forge hook installed (pg=true, db=sandbox)
✓ SELECT id, tier FROM users LIMIT 1          ← safe query, allowed
✗ SELECT * FROM users LIMIT 1                 ← wildcard, BLOCKED
⚠ connect → api.stripe.com → redirected to mock
```

Forge is the box; you bring the code. Real Postgres (pglite, no Docker), a mock
server for outbound calls, and a scoped filesystem — nothing touches real
systems.

[↑ Contents](#contents)

---

## The Interactive Shell

Run `forge` with no arguments to enter the full-screen shell (it takes over the
terminal like `lazygit`/`vim` and restores your scrollback on exit).

```
╭ ◆ FORGE   project · mode · policy · runs ──────────────────────────╮
╭ Setup ───────────────╮╭ Activity ──────────────────────────────────╮
│ ✓ project            ││  (transcript of commands + results)        │
│ ✓ database           ││                                            │
│ ○ simulation         ││                                            │
│ next step            ││                                            │
│ forge sim add        ││                                            │
│ workspace            ││                                            │
│ db / mocks / agent   ││                                            │
╰──────────────────────╯╰────────────────────────────────────────────╯
› forge ▏
⏎ run/next  Tab complete  ↑↓ history  forge guide  Ctrl-C exit (or forge exit)
```

- **Type `forge`** → a live, filtering suggestion palette of every command.
- **`Tab`** completes, **`Enter`** runs (drills into subcommands until runnable).
- **`↑/↓`** navigate suggestions, or recall **history** when none are open.
- **`←/→`** edit within the line.
- Commands that need input (e.g. `forge db link`) open a **guided form**.
- A live **setup checklist** shows where you are and the next step.
- **`forge guide`** opens a 6-step walkthrough; **`Ctrl-C`** / **`forge exit`** quits.

The same commands also work one-shot from your OS shell (`forge mock add stripe`)
for scripting and CI.

[↑ Contents](#contents)

---

## The Real Engine

`forge run --real` runs your actual app inside an ephemeral local sandbox and
intercepts everything it does. Full design: [`docs/09-ENGINE-ARCHITECTURE.md`](docs/09-ENGINE-ARCHITECTURE.md).

```
forge run --real
  1. start sandbox Postgres, seeded from your schema   ── in-process pglite (no Docker) by default
  2. start a local mock HTTP server (Stripe/SendGrid)
  3. spawn your app with NODE_OPTIONS=--import <forge-hook>
        the hook patches pg/http/fs → policy verdict → ENFORCE → reports over IPC
  4. fire synthetic persona/script traffic at the app → real assertions
  5. same dashboard + run report → teardown
```

**Enforcement** happens *inside* the app's process, synchronously: a **pass**
forwards the call to the sandbox, a **rewrite** mutates it (adds a `WHERE`,
strips PII, swaps a host for the mock), a **block** throws the policy reason
into the app. Because we intercept at the library boundary, there is **no TLS
MITM and no CA to trust**.

**To do a real run** (no Docker required):

```bash
# one-time: install the sample app's dependency
cd examples/acme-checkout && npm install && cd -

# in your forge project:
forge target set "node src/server.mjs" --port 3000 --cwd <abs path to examples/acme-checkout>
forge run --real                 # in-process pglite sandbox DB
forge run --real --db docker     # opt into a Docker Postgres container instead
```

The sample app ([`examples/acme-checkout`](examples/acme-checkout)) ships an
**intentional bug** (no error handling for an expired card + active coupon), so
the `expired_card_with_coupon` simulation surfaces a *real* failure — not a
seeded number.

> The DB backend is a swappable interface. The **default is pglite** (real
> Postgres via WASM, in-process, zero infrastructure) so `--real` runs anywhere;
> `--db docker` opts into a real Postgres container for concurrency/closest-to-prod.

[↑ Contents](#contents)

---

## Project Structure

```
forge-prototype/
├── docs/                      # full spec + design package (read these first)
│   ├── 01-PRD.md … 08-ROADMAP.md
│   └── 09-ENGINE-ARCHITECTURE.md   # the real engine design
├── examples/
│   └── acme-checkout/         # sample target app for `--real` (with an intentional bug)
├── src/
│   ├── cli.ts                 # commander entry; bare `forge` → interactive shell
│   ├── types.ts               # shared TypeScript types
│   ├── commands/              # one file per one-shot CLI command
│   │   └── init · db · mock · sim · attach · run · target · log · diff · report · approve · connect
│   ├── core/                  # engine-agnostic logic
│   │   ├── policyEngine.ts     # PURE pass/rewrite/block rules (the heart)
│   │   ├── runEngine.ts        # scripted, event-emitting run engine
│   │   ├── plainRenderer.ts    # line-by-line terminal output (CI/pipe)
│   │   ├── fakeAgent.ts        # scripted operation/diff/sim generator
│   │   ├── store.ts            # forge.yaml + .forge/ state persistence
│   │   ├── simDb.ts · mockApi.ts · diffFormat.ts · ui.ts
│   ├── shell/                 # the interactive `forge` app (Ink)
│   │   ├── Shell.tsx           # full-screen layout + command bar
│   │   ├── registry.ts         # every command as a shell entry
│   │   ├── suggest.ts          # `forge`-triggered autocomplete
│   │   ├── FormView · GuideView · Checklist · RunView
│   ├── tui/                   # shared TUI pieces (also used by `forge tui`)
│   │   ├── Dashboard.tsx · useRunState.ts · components.tsx · brand.ts · Welcome · Tour
│   └── engine/                # the REAL engine
│       ├── realRun.ts          # orchestrator (emits the same events as runEngine)
│       ├── types.ts            # backend / hook / IPC contracts
│       ├── hook/               # the preload hook (pg/http/fs patches + IPC)
│       ├── backends/           # postgres (Docker) · mockServer · fsSandbox
│       └── driver/             # sim driver + persona → request synthesis
├── .forge/                    # generated per project: runs, reports, diffs, sims, schema
└── package.json · tsconfig.json
```

**The one rule that makes this tractable:** `core/policyEngine.ts` is a pure
function and both engines emit the **same `RunEngineEvents`**, so the policy
logic and the entire UI/report pipeline are shared between the scripted and real
engines.

[↑ Contents](#contents)

---

## How It Works

**One core loop, two producers.** A run is a stream of typed events
(`header → file → op → stat → sim:* → done`). The scripted `RunEngine` produces
them from a built-in scenario; the real `RealRunEngine` produces them from a
live app via the hook. Both implement a shared `RunSource` interface, so the
dashboard, the plain renderer, and the report consume either one unchanged.

**The policy engine** (`core/policyEngine.ts`) is a pure
`evaluateOperation(op, resolvedPolicy, ctx) → verdict`. It runs six rules in
order (wildcard-SELECT block, destructive-statement block, unscoped UPDATE/DELETE
rewrite, PII allowlist, filesystem-scope block, HTTP→mock redirect) and returns
the first non-pass verdict. Presets (`default/strict/soc2/hipaa`) expand to an
active rule set via `resolvePolicyRules`.

**Enforcement** (real engine) turns a verdict into action at the call site:
`pass` forwards, `rewrite` mutates-then-forwards, `block` throws. See
[`docs/06-POLICY-ENGINE-SPEC.md`](docs/06-POLICY-ENGINE-SPEC.md) and
[`docs/09-ENGINE-ARCHITECTURE.md`](docs/09-ENGINE-ARCHITECTURE.md).

[↑ Contents](#contents)

---

## Command Reference

| Command | What it does |
|---|---|
| `forge` | launch the interactive shell |
| `forge init [name]` | scaffold a Forge project (`forge.yaml` + `.forge/`) |
| `forge db link <conn>` | register a DB connector + generate synthetic rows |
| `forge db status` | show the linked database + schema |
| `forge mock add <service>` | register a mock API (`stripe`/`sendgrid`/`twilio`) |
| `forge sim add --file / --user-type` | register a simulation |
| `forge attach <agent> --scope <glob> [--exec <cmd>]` | connect an agent/command to the box; `forge run` then runs it sandboxed |
| `forge target set <start> --port <n>` | configure the app for `--real` runs |
| `forge run [--real] [--task …] [--policy …]` | run the sandbox (scripted or real) |
| `forge box <command>` / `forge run --exec <command>` | run **any command** inside the isolated box |
| `forge diff <run-id>` | show a run's code diff |
| `forge report <run-id>` | render a run's full report |
| `forge approve <run-id> [--force]` | approve a run (gated by pass rate) |
| `forge connect / disconnect <provider>` | (simulated) CI/CD integration |
| `forge guide` · `forge tui` | walkthrough · standalone live dashboard |

[↑ Contents](#contents)

---

## Configuration

`forge.yaml` (project root, committed to version control) is the single source
of truth. Full schema: [`docs/03-FORGE-YAML-SPEC.md`](docs/03-FORGE-YAML-SPEC.md).

```yaml
project: acme-checkout
mode: sandbox                 # sandbox | ci | cd
data:
  databases: [{ name: primary, type: postgres, sim_rows: 50000, ... }]
  mocks:     [{ name: stripe, preset: ecommerce, ... }]
simulations: [{ name: edge-cases, file: .forge/sims/edge-cases.yaml, sessions: 500 }]
policy:
  preset: default            # default | strict | soc2 | hipaa | custom
  on_intercept: rewrite
  on_block: notify_agent
agents:  [{ name: cursor, scope: "./src/checkout/**", ... }]
approve: { require_pass_rate: 95, ... }
target:                       # set by `forge target set` — needed for `--real`
  start: "node src/server.mjs"
  port: 3000
  cwd: ./examples/acme-checkout
```

[↑ Contents](#contents)

---

## Spec and Design Docs

Read in order to understand the project (human or AI picking it up):

| Doc | Covers |
|---|---|
| [`01-PRD.md`](docs/01-PRD.md) | the problem, the solution, v0 scope |
| [`02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) | module layout, command responsibilities, data flow |
| [`03-FORGE-YAML-SPEC.md`](docs/03-FORGE-YAML-SPEC.md) | the `forge.yaml` config schema |
| [`04-SIM-YAML-SPEC.md`](docs/04-SIM-YAML-SPEC.md) | simulation file format (declarative + scripted) |
| [`05-CLI-UX-SPEC.md`](docs/05-CLI-UX-SPEC.md) | exact expected terminal output per command |
| [`06-POLICY-ENGINE-SPEC.md`](docs/06-POLICY-ENGINE-SPEC.md) | the intercept/rewrite/block rules |
| [`07-FAKE-AGENT-SPEC.md`](docs/07-FAKE-AGENT-SPEC.md) | the scripted demo scenario |
| [`08-ROADMAP.md`](docs/08-ROADMAP.md) | what's deferred and why |
| [`09-ENGINE-ARCHITECTURE.md`](docs/09-ENGINE-ARCHITECTURE.md) | **the real engine** design (Phases 2–4) |

[↑ Contents](#contents)

---

## Testing

```bash
npm test        # node:test via tsx — 45 tests
```

Coverage spans the pure policy engine, the real enforcement core (pg/http/fs
interception, against fake modules), the mock server, the FS sandbox, the
Postgres seed-SQL builder, the sim driver (against a stub server), the
orchestrator (with fake backends), and the interactive shell + TUI (headless via
`ink-testing-library`). Everything runs **without Docker**; only a full live
`--real` run needs it.

[↑ Contents](#contents)

---

## Real vs Simulated

| Piece | Status |
|---|---|
| CLI + interactive shell + TUI | **Real** |
| `forge.yaml` read/write, run reports, diffs, approval gate | **Real** |
| Policy engine (6 rules, presets) | **Real**, pure, unit-tested |
| Scripted `forge run` (agent scenario, sim numbers) | Deterministic fake — the demo |
| Real interception (`--real`): pg/http/fs hook + enforcement | **Real**, tested, runs end-to-end |
| Sandbox Postgres (pglite in-process, or Docker) + mock server + FS sandbox | **Real** — no Docker needed |
| Sim driver (persona/script → real HTTP → assertions) | **Real**, tested |
| OS-level syscall interception, hardened container isolation | Not yet — see roadmap |

[↑ Contents](#contents)

---

## Roadmap and Status

**Done:** full CLI lifecycle, interactive shell, both engines, real
pg/http/fs interception + enforcement, Docker Postgres + mock + FS sandbox, sim
driver, orchestrator, 45 tests.

**Next / deferred** (see [`docs/08-ROADMAP.md`](docs/08-ROADMAP.md) and
[`docs/09`](docs/09-ENGINE-ARCHITECTURE.md)):
- `pglite` DB backend so `--real` runs with **no Docker**
- SQL parsing via `node-sql-parser` (replacing regex matching)
- Hardened **container-network** mode (the app physically cannot reach prod)
- Real GitHub/CI integration; multi-agent sessions; OS syscall interception

[↑ Contents](#contents)

---

## For Contributors

**Where to start reading:** [`docs/01-PRD.md`](docs/01-PRD.md) →
[`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) → `src/core/policyEngine.ts`
(the heart) → `src/core/runEngine.ts` (events) → `src/engine/realRun.ts` (the
real orchestrator).

**Build & test:**
```bash
npm install
npm run build      # tsc → dist/
npm test           # node:test
npm link           # re-expose the global `forge` from the new build
```

**The design seam to respect:** keep `core/policyEngine.ts` pure (no I/O), and
keep both engines emitting the same `RunEngineEvents`. New rules go in the policy
engine; new interception surfaces go in `src/engine/hook/`; the UI never needs to
know which engine produced an event.

After any source change, run `npm run build` (the global `forge` runs from
`dist/`).

[↑ Contents](#contents)
