# Forge — Working Context & Session Log

> Living document. Read this first when picking up the project in a new session.
> It captures what Forge is, its **real** (not aspirational) state, decisions made,
> and the task backlog. Update the Session Log at the bottom as work lands.

Last updated: **2026-07-13**

---

## 1. What Forge is (accurate framing)

Forge is a **local Node.js/TypeScript CLI + TUI** that acts as an execution
boundary between an AI coding agent (or any command) and production systems.
You run a command *inside Forge's box*; Forge intercepts its DB queries, outbound
HTTP, and filesystem writes, evaluates each against a **policy engine**, seeds a
**sandbox Postgres** (pglite) from your schema shape, mocks third-party APIs, can
drive **simulations** against a target app, and produces a **run report + diff**
gated by an approval step.

**Critical truth about the "sandbox":** interception is **in-process
monkeypatching** (`patchPg` / `patchHttp` / `patchFs` preloaded into the spawned
process). It is a **policy/UX layer, not a containment boundary.** Code escapes it
via child processes, raw `net`/`dgram` sockets, `fetch`/undici, native addons, or
any non-`pg` driver. This shapes the whole roadmap and every trust claim.

Tagline: *"The execution boundary between your AI agent and production."*

---

## 2. Repo, environment, git identity

- **Repo:** `E:\SANDTEST\forge-prototype` → GitHub `whileTrueFalse/FORGE` (branch `main`).
- **Website (separate):** `E:\SANDTEST\frontend\forge-website` — static marketing
  site. `share.ps1` there serves it + opens a public ngrok tunnel (one command).
- **Git identity is dynamic:** global = work account `samarth-winbold-dev`; this
  repo is pinned **local** to the personal account:
  - `user.name = whileTrueFalse`, `user.email = 117916649+whileTrueFalse@users.noreply.github.com`
  - `credential.username = whileTrueFalse` (GCM picks the right token; no `gh` helper override)
  - Reuse for future personal repos: set the same 3 `git config --local` lines.
  - `gh` CLI is machine-wide (still work account) → run `gh auth switch --user whileTrueFalse`
    before `gh pr create` etc. in this repo.

---

## 3. Architecture snapshot

- `src/cli.ts` — commander entry (one-shot CLI).
- `src/shell/` — interactive Ink TUI (`Shell.tsx`, `registry.ts` command table,
  `FormView`, `Checklist`, `GuideView`, `RunView`).
- `src/engine/` — the **real** engine:
  - `hook/patchPg.ts` `patchHttp.ts` `patchFs.ts` `intercept.ts` `preload.ts` — in-process interception.
  - `backends/pglite.ts` `postgres.ts` `mockServer.ts` — sandbox DB + mocks.
  - `driver/simDriver.ts` `personas.ts` — fires **real** `fetch()` at a target app; pass/fail from real 5xx.
  - `realRun.ts` — orchestrator for `forge run --real` (server + sims).
- `src/core/` — `policyEngine.ts`, `runEngine.ts` (scripted run), `runner.ts`,
  `store.ts` (forge.yaml + `.forge/` state), `simDb.ts`, `mockApi.ts`, `freeFlow.ts`.
- `src/tui/` — standalone TUI + Ember brand palette (`brand.ts`).
- Tests: `*.test.ts(x)` run via `node --import tsx --test`. **51 passing.**

### What's REAL vs SIMULATED (important)
- `forge run --real` (needs a target): **real** interception + **real** sampled sim
  pass rates (sampled, then extrapolated to total sessions). Genuine.
- `forge run` (scripted) and `forge box "<cmd>"`: real interception of the executed
  command, but sim numbers are synthetic/absent. **Do not present these as real.**
- `forge attach <agent>`: records intent only — does **not** spawn/wrap the agent.
  The genuine execution path is `forge box "<cmd>"` / `--exec`.
- Interception coverage today: **Node.js only · `pg` only · `http`/`https` + `fetch`/undici.**
  No mysql/mongo, no non-Node runtimes. (fetch added 2026-07-13, task #1.)

---

## 4. Product philosophy: free-flow (decided 2026-07-13)

Forge must **not** force a wizard. Devs get full control; setup steps are optional.
- No agent required to run — a full-scope default agent is synthesized (`core/freeFlow.ts`).
- Kept guardrails: `--real` still needs a target; the policy engine always evaluates.
- `db` / `mock` / `sim` / `attach` are optional, any order.
- **Guided vs Free toggle:** `forge mode guided|free`. Guided (default) shows the
  setup checklist + next-step hints; free hides them. Persisted per project in
  `.forge/state.json` (`shellMode`); topbar shows the active mode.
- `forge box "<command>"` is the zero-setup front door.

---

## 5. Beta / production readiness — gap analysis

**Reframe:** "deploy" = (a) ship the CLI to devs (npm), and (b) an optional hosted
team/CI layer that barely exists.

**🔴 Value-prop blockers**
1. Sandbox is not real containment (in-process patch, escapable) — existential for a *security* tool.
2. Sim results only real in `--real`; defaults must never show synthetic numbers as real.
3. Real agent attach doesn't exist (records intent).

**🟠 Coverage constraints:** Node-only · Postgres-only · http-only · single-user/machine.

**🟡 Distribution:** not on npm, no releases/semver/changelog, no cross-platform matrix, no auto-update/signing.

**🟡 Hosted/team:** `forge connect github` is a stub; no accounts/auth/org policy/dashboard/backend/billing.

**🟡 Trust/legal:** need threat model + scope doc, data-handling statement, LICENSE/ToS/privacy/SECURITY.md.

**🟢 Reliability/ops:** no CI, no crash/error reporting, no telemetry; partial graceful degradation.

**Minimum bar for a closed developer beta:**
1. Real path is the default; synthetic numbers never shown as real.
2. `fetch` interception + `pg`-connection rerouting airtight (tasks #1, #2).
3. Explicit threat-model/scope doc ("Node/pg/http, in-process, not containment").
4. npm publish + CI + versioning (task #7).
5. Narrow marketing claims to what's real.
Everything else (true containment, multi-runtime, hosted/CI/team, auth, billing) is post-beta/GA.

---

## 6. Task backlog

Tracked in the session task list. Priority order:

| # | Task | Bucket | Status |
|---|---|---|---|
| 7 | CI workflow (tsc + tests on push/PR) | infra — do first (guards the rest) | ✅ done |
| 1 | Intercept `fetch`/undici outbound HTTP | 🔴 beta-gate | ✅ done |
| 2 | Harden DB connection rerouting to sandbox | 🔴 beta-gate | ✅ done |
| 3 | Harden SQL parsing in the policy path | 🟠 beta-gate | ✅ done |
| 4 | Tests for free-flow runs + mode toggle | 🟡 lock-in | ✅ done |
| 5 | Document free-flow model + `forge mode` | 🟡 lock-in | ✅ done |
| 6 | Apply Ember theme to GuideView + Dashboard | 🟢 polish | ✅ done |

**Agreed sequence:** #7 → #1 → #2 → #3 → #4/#5 → #6.

---

## 7. Conventions

- Tests must stay green (`npm test`) and `npx tsc --noEmit` clean before commit.
- Commit only when asked; this repo pushes direct to `main` (solo personal repo).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- ASCII-only in PowerShell scripts (PS 5.1 mis-parses non-ASCII no-BOM UTF-8).

---

## 8. Session log

### 2026-07-13
- Website sharing: built `share.ps1` (serve static site + ngrok public URL, one
  command). Fixed em-dash parse bug (ASCII-only), npm-wrapper-vs-real-exe auto-stop,
  and ERR_NGROK_4018 (multi-path token search + `-Token` override). Verified end-to-end.
- **Free-flow shipped** (commit `20966b0`): dropped forced setup / agent gate, added
  `forge mode guided|free`, `core/freeFlow.ts`, `forge box` as front door. 51 tests pass.
- Git identity: pinned this repo local to `whileTrueFalse`; global stays work account.
- Beta-readiness gap analysis completed (section 5).
- Created this doc.
- **Task #7 done:** added `.github/workflows/ci.yml` (typecheck + test matrix over
  ubuntu/windows × node 20/22) + README CI badge. tsc clean, 51 tests pass.
- **Task #1 done:** `patchFetch.ts` wraps global `fetch` (undici) — block unmocked /
  redirect mocked / pass relative — wired into `preload.ts`; 5 new tests. 56 tests pass.
  Note: covered by unit + wiring tests (parity with how patchHttp is tested); no spawned
  e2e for fetch yet.
- **Task #2 done:** `forcePgSandboxConnection` in `patchPg.ts` subclasses pg `Client`/`Pool`
  so the constructor ignores app-hardcoded host/db and always uses the sandbox
  `connectionString` (threaded via `installPgPatch(deps, config.dbUrl)` in preload). Closes
  the bypass where `new Client({host:'prod'})` reached prod. +1 test, 57 pass.
  **Residual gap (containment, out of scope):** covers CJS `require('pg')` + `new`
  construction; a raw `net.connect` to a prod DB port, a non-`pg` driver, or ESM
  live-binding edge cases still bypass — that's the in-process-patch limitation, not a
  connection-rerouting bug.
- **Task #3 done:** `core/sqlNormalize.ts` (strip comments, blank string-literal
  contents, split statements) + refactored the policy SQL rules to match on the
  normalized, per-statement form. Closes: comment-hidden `SELECT *`, `DROP` split by a
  comment, unscoped mutation hidden after a `;` (now blocked as a multi-statement batch),
  and `WHERE` faked inside a string literal. +8 tests, 65 pass. All 🔴/🟠 correctness
  beta-gates now done.
- **Task #4 done:** tests for free-flow — `freeFlow.test.ts` (default agent shape),
  `commands/run.test.ts` (scripted run with agents:[] completes + records a run, no
  error), `shell/registry.test.ts` (`forge mode` free/guided persists in state.json,
  show, bad-value rejected). 68 pass.
- **Task #5 done:** documented free-flow — README (free-flow callout + `forge mode` in
  the command table), in-shell tour (`Tour.tsx` new "Running it (free-flow)" step), and
  `docs/05-CLI-UX-SPEC.md` (new "Free-flow & shell modes" section + softened `init` hint).
  68 pass.
- **Task #6 done:** GuideView/Tour were already Ember (they render through the shared
  `Panel`, which uses `theme = palette` + single borders + uppercased titles). Aligned
  the Dashboard's two `borderStyle="round"` boxes to `single` — all borders now
  single/edge across tui + shell. 68 pass.

- **CI red on first run — fixed:** run #1 failed on every job except windows+node22.
  Root cause: the test script used `node --test "src/**/*.test.ts"`, but `--test` glob
  patterns are Node 21+ only — on Node 20 node treats it as a literal path and exits 1
  (and node22's glob may match nothing on linux). Replaced with `scripts/test.mjs` — a
  portable runner that discovers `*.test.ts(x)` via fs and passes explicit paths to
  `node --import tsx --test`. Works on Node 20+ and every OS. 68 pass locally. If a job
  is still red after this, it's a genuine per-OS test failure — get the log from the
  Actions tab (gh can't read it: work account, private repo).
- **CI still red (run #8) — TUI test flakiness fixed:** portable runner fixed node20, but
  the pass/fail set *reshuffled* (only win-node20 passed) — proof of nondeterminism. Cause:
  the Ink TUI tests (`Shell.test.tsx`, `App.test.tsx`) asserted on rendered frames after
  fixed `delay()`s, which race on slow/shared GitHub runners. A clean Linux+node22 Docker
  run passed 68/68 (fast machine), confirming it's timing, not a real bug. Fix: added
  `src/testWait.ts` (`waitFor` poll helper) and rewrote both TUI test files to (a) settle
  briefly so Ink attaches/re-subscribes its `useInput` handler before a keypress — pressing
  Enter too early hits a stale closure and the command never runs — and (b) poll for the
  post-action frame instead of sleeping. 68/68, Shell tests stable ×3 locally. (Docker
  Desktop too flaky here to run the throttled-CPU confirmation; fix is principled.)

- **CI GREEN (run #9, commit 1cbbeec):** all 4 matrix jobs (ubuntu/windows × node 20/22)
  passed in ~1m5s. The two-stage fix (portable runner + waitFor-based TUI tests) worked.

### ✅ All 7 backlog tasks complete (2026-07-13). 68 tests green, tsc clean, CI green, all pushed to main.
The 🔴/🟠 correctness beta-gates (fetch, DB reroute, SQL hardening) + CI + free-flow
tests/docs + Ember polish are done. **Next frontier is post-beta / GA** (see section 5):
true containment boundary, multi-runtime/multi-DB coverage, hosted CI/team layer, auth,
threat-model doc, npm publish + releases. None started — pick up from section 5's cut-line.
