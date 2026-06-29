// Headless smoke test for the TUI dashboard. ink-testing-library renders
// Ink components without a real terminal, so we can assert the panel scaffold
// mounts and the engine drives state to completion. Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { RunEngine } from "../core/runEngine.js";
import type { ForgeConfig } from "../types.js";

function buildConfig(): ForgeConfig {
  return {
    project: "acme-checkout",
    version: 1,
    mode: "sandbox",
    data: {
      databases: [
        {
          name: "primary",
          type: "postgres",
          schema_from: "postgres://x",
          sim_rows: 50000,
          distributions: "auto",
          linked_at: "2026-01-01T00:00:00Z",
        },
      ],
      mocks: [{ name: "stripe", preset: "ecommerce", added_at: "2026-01-01T00:00:00Z" }],
    },
    simulations: [{ name: "edge-cases", file: ".forge/sims/edge-cases.yaml", sessions: 500 }],
    policy: {
      preset: "default",
      rules: [{ pii_fields: ["email", "phone", "address", "ssn"] }],
      on_intercept: "rewrite",
      on_block: "notify_agent",
    },
    agents: [
      { name: "cursor", scope: "./src/checkout/**", read_only: [], env: "sandbox", attached_at: "2026-01-01T00:00:00Z" },
    ],
    approve: { require_pass_rate: 95, require_zero_blocks: false, human_approval: true },
    integrations: {},
    sessions: { mode: "isolated", conflict_detection: true, merge_on_approve: true },
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("TUI: welcome screen mounts with branding and session overview", () => {
  const config = buildConfig();
  const engine = new RunEngine({ runId: "run-1", task: "add coupon validation", agent: config.agents[0], config, exitOnBlock: false });
  const { lastFrame, unmount } = render(<App engine={engine} config={config} task="add coupon validation" />);
  const frame = lastFrame() ?? "";
  assert.match(frame, /This session/);
  assert.match(frame, /How a run works/);
  assert.match(frame, /start run/); // key hint
  unmount();
});

test("TUI: pressing enter starts the run and drives it to completion", async () => {
  const config = buildConfig();
  const engine = new RunEngine({ runId: "run-1", task: "t", agent: config.agents[0], config, exitOnBlock: false });
  let resolveDone: () => void;
  const donePromise = new Promise<void>((r) => (resolveDone = r));
  engine.once("done", () => resolveDone());
  const { lastFrame, stdin, unmount } = render(<App engine={engine} config={config} task="t" />);

  await delay(30);
  stdin.write("\r"); // Enter → start run

  // Await the run's completion directly (sleeps no-op under non-TTY stdout),
  // with a generous safety timeout so a cold start can't flake the poll budget.
  let timedOut = false;
  await Promise.race([donePromise, delay(4000).then(() => (timedOut = true))]);
  await delay(20); // let the final frame render

  assert.equal(timedOut, false);
  const frame = lastFrame() ?? "";
  assert.match(frame, /RUN COMPLETE/);
  assert.match(frame, /Live Policy Log/);
  unmount();
});
