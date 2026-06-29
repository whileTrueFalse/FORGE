// Tests the hook enforcement core: a pass forwards the original call, a rewrite
// forwards the corrected call, a block throws and never forwards — all driven
// through the real policy engine. No pg/Docker/app needed.

import test from "node:test";
import assert from "node:assert/strict";
import { resolvePolicyRules, buildKnownMocksMap, type PolicyEvalContext } from "../../core/policyEngine.js";
import { interceptDbQuery, interceptHttpConnect, interceptFsWrite, ForgeBlockedError, type InterceptDeps } from "./intercept.js";
import type { AgentOperation, PolicyConfig, PolicyVerdict } from "../../types.js";

const policyConfig: PolicyConfig = {
  preset: "default",
  rules: [{ pii_fields: ["email", "phone", "address", "ssn"] }],
  on_intercept: "rewrite",
  on_block: "notify_agent",
};

function makeDeps(): { deps: InterceptDeps; emitted: Array<{ op: AgentOperation; verdict: PolicyVerdict }> } {
  const emitted: Array<{ op: AgentOperation; verdict: PolicyVerdict }> = [];
  const ctx: PolicyEvalContext = {
    scope: "./src/checkout/**",
    readOnly: ["./src/auth/**"],
    knownMocks: buildKnownMocksMap(["stripe"]),
  };
  return {
    emitted,
    deps: { policy: resolvePolicyRules(policyConfig), ctx, emit: (op, verdict) => emitted.push({ op, verdict }) },
  };
}

test("db: a safe query forwards the original SQL", async () => {
  const { deps, emitted } = makeDeps();
  const forwarded: string[] = [];
  const op: AgentOperation = { id: "1", kind: "db_query", sql: "SELECT id FROM orders WHERE user_id = ?", file: "x" };
  const out = await interceptDbQuery(op, deps, async (sql) => {
    forwarded.push(sql);
    return "rows";
  });
  assert.equal(out, "rows");
  assert.deepEqual(forwarded, ["SELECT id FROM orders WHERE user_id = ?"]);
  assert.equal(emitted[0].verdict.verdict, "pass");
});

test("db: an unscoped UPDATE forwards the rewritten SQL", async () => {
  const { deps } = makeDeps();
  const forwarded: string[] = [];
  const op: AgentOperation = { id: "2", kind: "db_query", sql: "UPDATE orders SET status = ?", file: "x" };
  await interceptDbQuery(op, deps, async (sql) => {
    forwarded.push(sql);
    return null;
  });
  assert.equal(forwarded[0], "UPDATE orders SET status = ? WHERE id = ? AND user_id = ?");
});

test("db: a wildcard SELECT throws and never forwards", async () => {
  const { deps } = makeDeps();
  let forwarded = false;
  const op: AgentOperation = { id: "3", kind: "db_query", sql: "SELECT * FROM users", file: "x" };
  await assert.rejects(
    () => interceptDbQuery(op, deps, async () => ((forwarded = true), null)),
    ForgeBlockedError
  );
  assert.equal(forwarded, false);
});

test("http: known third-party redirects to the mock host", () => {
  const { deps } = makeDeps();
  const op: AgentOperation = { id: "4", kind: "http_connect", host: "api.stripe.com", file: "x" };
  const d = interceptHttpConnect(op, deps);
  assert.equal(d.action, "rewrite");
  assert.equal(d.redirectedTo, "forge-mock://stripe");
});

test("http: an unmocked host is blocked", () => {
  const { deps } = makeDeps();
  const op: AgentOperation = { id: "5", kind: "http_connect", host: "api.openai.com", file: "x" };
  const d = interceptHttpConnect(op, deps);
  assert.equal(d.action, "block");
});

test("fs: writes outside scope are denied, in-scope allowed", () => {
  const { deps } = makeDeps();
  const outside: AgentOperation = { id: "6", kind: "fs_write", path: "./src/billing/x.ts", file: "x" };
  const inside: AgentOperation = { id: "7", kind: "fs_write", path: "./src/checkout/y.ts", file: "y" };
  assert.equal(interceptFsWrite(outside, deps).allowed, false);
  assert.equal(interceptFsWrite(inside, deps).allowed, true);
});
