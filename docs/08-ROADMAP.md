# Roadmap — Beyond v0

This prototype (v0) intentionally fakes the hardest systems-level pieces so
the CLI lifecycle and data shapes can be validated quickly. This doc records
what's deferred and why, so later work has clear direction and v0 isn't
mistaken for a finished product.

## Phase 1 (this prototype): CLI lifecycle, fully simulated

Covered by `01-PRD.md` through `07-FAKE-AGENT-SPEC.md`. A real, runnable
Node/TS CLI with an in-memory/file-backed fake backend. No real agent, no
real interception, no real CI.

## Phase 2: Real syscall interception

Replace `core/fakeAgent.ts`'s scripted operation generator with **actual**
process-level interception of a real agent process:

- Linux: `ptrace`-based interception (similar to `strace`), or an eBPF
  program attached to relevant syscalls (`connect`, `sendto`, `openat`,
  `write`) for lower overhead.
- macOS: `dtrace`-based equivalent, or a launchd-managed wrapper process.
- The policy engine's `evaluateOperation` contract should not need to
  change — only how `AgentOperation`s are produced (real syscall data
  instead of a script) changes.
- Key design challenge: intercepting `connect()` to redirect a Postgres
  connection to a local sim database, and intercepting outbound HTTPS to
  redirect to local mocks, while keeping the agent's process believing it
  successfully reached the real endpoint (likely via a local
  proxy/forwarder bound to the intercepted socket).

## Phase 3: Real LLM agent integration

Wire forge into actual coding agents (Cursor, Claude Code, Copilot Workspace)
by:
- Documenting how each agent's process should be launched under forge's
  interception layer (`forge attach <agent>` actually spawning/wrapping the
  real agent process, not just recording intent in `forge.yaml`).
- Handling real, much higher-volume and less predictable operation streams
  than the fixed v0 script — the live log UI/pacing logic from v0 should
  mostly carry over, but volume controls (collapsing/sampling very repetitive
  operations) will be needed.

## Phase 4: Real simulation execution

Move from "plausible fake pass/fail numbers" to actually running the agent's
modified code against the sim database and mocks, executing the declarative/
scripted sim definitions for real (e.g. spinning up the app under test,
firing real HTTP requests shaped by personas/scripts, asserting on real
responses). This is the single biggest scope jump in the whole roadmap and
likely deserves its own dedicated spec when it's started.

## Phase 5: Multi-agent session negotiation

Implement the three-way negotiation (`shared` / `isolated` / `isolated-sync`)
described in the product brainstorm:
- Scope/resource overlap detection between two or more attached agents.
- The interactive CLI prompt shown in earlier design exploration
  (`forge attach <agent2>` detecting overlap with an already-attached
  agent and asking the developer to choose a session mode).
- For `isolated-sync`: a merge step that reconciles two independent sandbox
  runs' diffs and reports a combined view, flagging any conflicting changes.

## Phase 6: Real CI/CD integration

Replace the `forge connect github` / `forge connect github-actions` /
`forge connect vercel` stubs with real integrations:
- A GitHub App that posts run reports as PR check runs.
- A generated `.github/workflows/forge.yml` that actually invokes forge in
  CI and gates merge on pass-rate/policy thresholds.
- Deployment-hook integration (Vercel, etc.) that blocks a deploy pending
  forge approval.

## Phase 7: `forge tui` — real full-screen terminal UI

v0 simulates the feel of a live TUI using sequential, paced, colorized
scrollable output. A real Phase 7 implementation would use a proper
alternate-screen TUI framework (e.g. `blessed`, `ink`, or a Go rewrite using
`bubbletea`) to deliver the actual multi-pane live view (connectors sidebar +
live log + metrics panel) shown in the product's earlier design mockups,
with real keybindings (`a` approve, `r` re-run, `s` stop, etc.).

## Explicit Non-Goals Even Long-Term

- Forge is not a replacement for code review or a CI/CD platform itself —
  it's a pre-review safety and evidence layer that plugs into existing
  tools.
- Forge does not aim to judge code quality/style — only safety, security
  policy adherence, and behavioral correctness against simulated data.
