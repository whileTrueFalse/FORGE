// Tests the real-run orchestrator with fully-faked backends, a fake spawned app
// (emits canned IPC ops), and a fake driver — so the orchestration logic (event
// sequence, stat aggregation, record assembly) is verified without Docker.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { RealRunEngine, parseUnifiedDiff, type RealRunDeps, type AppHandle } from "./realRun.js";
import type { ForgeConfig, HookMessage, SimResult } from "../types.js";

function config(): ForgeConfig {
  return {
    project: "acme", version: 1, mode: "sandbox",
    data: { databases: [{ name: "primary", type: "postgres", schema_from: "x", sim_rows: 1000, distributions: "auto", linked_at: "" }], mocks: [{ name: "stripe", preset: "ecommerce", added_at: "" }] },
    simulations: [{ name: "edge-cases", file: "f", sessions: 500 }],
    policy: { preset: "default", rules: [{ pii_fields: ["email"] }], on_intercept: "rewrite", on_block: "notify_agent" },
    agents: [{ name: "cursor", scope: "./src/**", read_only: [], env: "sandbox", attached_at: "" }],
    approve: { require_pass_rate: 95, require_zero_blocks: false, human_approval: true },
    integrations: {}, sessions: { mode: "isolated", conflict_detection: true, merge_on_approve: true },
    target: { start: "node app.mjs", port: 3000 },
  };
}

function fakeDeps(): RealRunDeps {
  const messages: EventEmitter = new EventEmitter();
  const app: AppHandle = {
    onMessage: (cb) => messages.on("m", cb),
    ready: Promise.resolve(),
    baseUrl: "http://127.0.0.1:3000",
    kill: () => {},
  };
  return {
    startDb: async () => ({ connectionString: () => "postgres://sandbox", seed: async () => {}, teardown: async () => {} }),
    startMock: async () => ({ url: "http://127.0.0.1:9", port: 9, serviceForHost: { "api.stripe.com": "stripe" }, calls: [], close: async () => {} }),
    createFs: () => ({ root: "/tmp/x", allows: () => true, teardown: async () => {} }),
    spawnApp: () => app,
    driveSim: async (sim): Promise<SimResult> => {
      // Real ops arrive via the hook while the driver fires traffic; emulate that.
      const ops: HookMessage[] = [
        { t: "op", op: { id: "1", kind: "db_query", sql: "SELECT id FROM orders WHERE user_id = ?", file: "server.mjs" }, verdict: { operation: { id: "1", kind: "db_query", sql: "x", file: "server.mjs" }, verdict: "pass" } },
        { t: "op", op: { id: "2", kind: "db_query", sql: "UPDATE orders SET status = ?", file: "server.mjs" }, verdict: { operation: { id: "2", kind: "db_query", sql: "x", file: "server.mjs" }, verdict: "rewrite", reason: "missing WHERE" } },
      ];
      for (const m of ops) messages.emit("m", m);
      return { name: sim.name, totalSessions: sim.sessions, passedSessions: 330, failedSessions: 170, failingPersona: "expired_card_with_coupon", failureReason: "unhandled" };
    },
    captureDiff: async () => [],
  };
}

test("realRun: emits header → op/stat → sim:result → done with a real record", async () => {
  const engine = new RealRunEngine({ runId: "run-1", task: "t", config: config() }, fakeDeps());
  const seen: string[] = [];
  for (const ev of ["header", "file", "op", "stat", "sim:start", "sim:result", "done"] as const) {
    engine.on(ev, () => seen.push(ev));
  }
  const outcome = await engine.run();

  assert.equal(seen[0], "header");
  assert.ok(seen.includes("op"));
  assert.ok(seen.includes("sim:result"));
  assert.equal(seen[seen.length - 1], "done");

  const r = outcome.record.report;
  assert.equal(r.policyStats.intercepts, 1); // the rewrite op
  assert.equal(r.simResults[0].failingPersona, "expired_card_with_coupon");
  assert.equal(r.passRate, 66); // 330/500
});

test("parseUnifiedDiff: extracts files, status, and +/- lines", () => {
  const diff = [
    "diff --git a/src/checkout.ts b/src/checkout.ts",
    "--- a/src/checkout.ts",
    "+++ b/src/checkout.ts",
    "@@ -41,3 +41,4 @@",
    " const x = 1;",
    "-old line",
    "+new line",
  ].join("\n");
  const files = parseUnifiedDiff(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "src/checkout.ts");
  const types = files[0].hunks[0].lines.map((l) => l.type);
  assert.deepEqual(types, ["context", "remove", "add"]);
});
