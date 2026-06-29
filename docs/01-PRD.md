# Forge — Product Requirements Document

## 1. Problem Statement

"Vibe coding" — letting AI agents (Cursor, Claude Code, Copilot, etc.) write and
execute code with minimal human review — is growing fast. Alongside it, real
incidents are growing too:

- AI agents running destructive SQL (`DROP TABLE`, unscoped `DELETE`/`UPDATE`)
  directly against production or shared databases.
- Agents leaking PII because they query more fields than necessary
  (`SELECT *` style exposure) with no field-level policy enforcement.
- Agents calling real third-party APIs (payments, email, SMS) during
  experimentation, causing real-world side effects (real charges, real emails).
- No audit trail of *what the AI actually did*, only the final diff — so when
  something breaks, nobody can reconstruct the sequence of actions that caused it.
- No safe way to let an AI agent "go wild" and test its own code against
  realistic data shapes before a human has to look at it.

The root cause: **AI agents currently operate with production-level reach in
development-level trust environments.** There is no execution boundary between
"AI writes code" and "code touches real systems."

## 2. Solution Summary

**Forge** is a terminal-based sandbox engine that sits between an AI coding
agent and the real world. It:

1. Intercepts the agent's process at the **syscall level** (network connects,
   file writes, process spawns) — no code changes needed in the agent or app.
2. Redirects database connections, file writes (outside an allowed scope), and
   third-party API calls to **simulated equivalents**: a synthetic database
   seeded from the real schema, mock APIs (Stripe, SendGrid, etc.), and a
   scoped filesystem view.
3. Runs **simulations** — declarative data/persona definitions and/or scripted
   user-journey scripts — against the agent's code changes, at scale (thousands
   of synthetic sessions), to catch behavioral bugs that small unit tests miss.
4. Applies a **policy engine** that can intercept-and-rewrite, warn, or
   hard-block specific operations (e.g. no `SELECT *`, require `WHERE` on
   `UPDATE`/`DELETE`, no PII fields outside an allowlist).
5. Produces a **run report** (diff + simulation results + policy violations)
   that a human reviews and explicitly approves before anything is allowed to
   reach a real environment, CI pipeline, or deployment.

Forge ships as a CLI + local daemon. Everything starts local-only — no GitHub
connection, no CI, no prod credentials are required or transmitted until the
developer explicitly opts in (`forge connect github`, etc.).

## 3. Goals (v0 prototype scope)

This prototype focuses on demonstrating the **full CLI lifecycle** end to end,
as a real, runnable Node/TypeScript CLI tool with realistic (simulated, not
literally OS-level) syscall interception behavior, against an in-memory fake
backend:

- `forge init` — scaffold `forge.yaml` for a project.
- `forge db link` — register a database connector, generate synthetic rows
  matching a schema.
- `forge mock add` — register a mock third-party API (e.g. Stripe-like).
- `forge sim add` — register a simulation (declarative and/or scripted).
- `forge attach <agent>` — attach a (simulated/fake, scripted) AI agent to the
  sandbox with a file scope.
- `forge run` — execute the attached agent's task against the sandbox; stream
  a realistic live log of intercepted operations (pass / rewrite / block);
  run the registered simulations; produce a run report.
- `forge log --follow` — tail the structured event log for a run.
- `forge diff <run-id>` — show the code diff produced by a run.
- `forge approve <run-id>` — mark a run approved; only then (and only if
  connected) would it be eligible to push to CI/CD.
- `forge connect github` / `forge disconnect github` — explicit, optional,
  reversible CI/CD graduation (can be partially stubbed in v0).

**Out of scope for v0** (documented for later phases, see `04-ROADMAP.md`):
real OS-level syscall interception (ptrace/eBPF), real LLM agent integration,
multi-agent session negotiation, real GitHub/CI integration, a TUI (curses-style
full-screen terminal UI) — v0 uses sequential scrollable terminal output styled
to evoke the TUI rather than a true alternate-screen interface.

## 4. Non-Goals

- Forge is not a replacement for code review. It is a pre-review safety and
  evidence layer.
- Forge does not itself decide whether code is "good" — it surfaces signal
  (policy violations, simulation pass rates, diffs) for a human to decide.
- Forge does not store or transmit real production data. Synthetic data is
  generated from schema shape, not copied from real rows.

## 5. Target Users

- Individual developers using AI coding agents (Cursor, Claude Code, Windsurf,
  Copilot Workspace, etc.) on real codebases with real databases.
- Small teams who want a shared, version-controlled (`forge.yaml`) safety net
  before AI-authored code reaches CI.
- Security-conscious teams (fintech, healthtech) who need an audit trail of
  AI agent actions before they'll allow AI-assisted development at all.

## 6. Key Design Principles

1. **Zero-friction adoption.** A single `forge init` plus a few `forge db
   link` / `forge mock add` commands should get a working sandbox. No GUI
   required, no account required for local-only mode.
2. **The agent should not need to know it's sandboxed.** Interception should
   be transparent — the agent's queries/calls "just work" against believable
   simulated responses.
3. **Policy violations are a feedback loop, not just a kill switch.** Where
   possible, intercept-and-rewrite with a reason so the agent can self-correct,
   rather than only hard-blocking and stalling the run.
4. **Dev stays in control of graduation.** Sandbox-only by default. CI/CD
   connection is explicit, reversible, and never silently enabled.
5. **Everything is inspectable.** Every run produces a structured, readable
   report: what changed (diff), what was tested (sim results), what was
   caught (policy log). No black box.
6. **Config as code.** `forge.yaml` is the single source of truth, committed
   to version control, human-readable, diffable.

## 7. Success Criteria for the Prototype

- `forge init` through `forge approve` runs end-to-end with no crashes on a
  clean machine with only Node.js installed.
- The simulated run log is realistic enough to use as a reference for what
  the real (syscall-level) product should look and feel like.
- The policy engine demonstrably does three distinct things in one run:
  passes a safe operation, rewrites an unsafe-but-fixable operation, and
  hard-blocks an unsafe-and-unfixable operation.
- A non-technical stakeholder can read the final run report
  (`.forge/reports/run-N.json` rendered to terminal) and understand what
  happened without reading code.
