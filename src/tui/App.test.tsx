// Headless smoke test for the TUI dashboard. ink-testing-library renders
// Ink components without a real terminal, so we can assert the panel scaffold
// mounts and the engine drives state to completion. Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { RunEngine } from "../core/runEngine.js";
import { waitFor } from "../testWait.js";
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
const has = (lastFrame: () => string | undefined, ...res: RegExp[]) => {
  const f = lastFrame() ?? "";
  return res.every((re) => re.test(f));
};

test("TUI: welcome screen mounts with branding and session overview", async () => {
  const config = buildConfig();
  const engine = new RunEngine({ runId: "run-1", task: "add coupon validation", agent: config.agents[0], config, exitOnBlock: false });
  const { lastFrame, unmount } = render(<App engine={engine} config={config} task="add coupon validation" />);
  await waitFor(() => has(lastFrame, /this session/i, /how a run works/i, /start run/));
  unmount();
});

test("TUI: pressing enter starts the run and drives it to completion", async () => {
  const config = buildConfig();
  const engine = new RunEngine({ runId: "run-1", task: "t", agent: config.agents[0], config, exitOnBlock: false });
  const { lastFrame, stdin, unmount } = render(<App engine={engine} config={config} task="t" />);

  await waitFor(() => has(lastFrame, /start run/)); // welcome mounted
  await delay(50); // let Ink attach the input handler before sending Enter
  stdin.write("\r"); // Enter → start run

  // Poll until the run has driven to completion + the final frame rendered,
  // rather than sleeping a fixed budget (which races on slow CI runners).
  await waitFor(() => has(lastFrame, /RUN COMPLETE/, /live policy log/i), { timeout: 15000 });
  unmount();
});
