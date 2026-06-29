// Unit tests for the policy engine. Ported from the worked examples in
// docs/06-POLICY-ENGINE-SPEC.md §"Worked Examples", plus coverage for the
// fs-scope, http-redirect, and strict-preset PII rules.
//
// Run with: npm test  (node --import tsx --test)

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOperation, resolvePolicyRules, buildKnownMocksMap } from "./policyEngine.js";
import type { AgentOperation, PolicyConfig } from "../types.js";

const defaultPolicy: PolicyConfig = {
  preset: "default",
  rules: [{ pii_fields: ["email", "phone", "address", "ssn"] }],
  on_intercept: "rewrite",
  on_block: "notify_agent",
};

const strictPolicy: PolicyConfig = { ...defaultPolicy, preset: "strict" };
const soc2Policy: PolicyConfig = { ...defaultPolicy, preset: "soc2" };

const resolvedDefault = resolvePolicyRules(defaultPolicy);
const resolvedStrict = resolvePolicyRules(strictPolicy);

const ctx = {
  scope: "./src/checkout/**",
  readOnly: ["./src/auth/**"],
  knownMocks: buildKnownMocksMap(["stripe"]),
};

function dbOp(sql: string, file = "checkout.service.ts"): AgentOperation {
  return { id: "op", kind: "db_query", sql, file };
}

test("rule 1: scoped explicit SELECT passes", () => {
  const v = evaluateOperation(dbOp("SELECT id, total FROM orders WHERE user_id = ?"), resolvedDefault, ctx);
  assert.equal(v.verdict, "pass");
});

test("rule 3: unscoped UPDATE rewrites with a WHERE clause", () => {
  const v = evaluateOperation(dbOp("UPDATE orders SET status = ?"), resolvedDefault, ctx);
  assert.equal(v.verdict, "rewrite");
  assert.match(v.reason ?? "", /missing WHERE clause/i);
  assert.equal(v.rewrittenOperation?.sql, "UPDATE orders SET status = ? WHERE id = ? AND user_id = ?");
});

test("rule 3: scoped UPDATE passes (already has WHERE)", () => {
  const v = evaluateOperation(dbOp("UPDATE orders SET status = ? WHERE id = ?"), resolvedDefault, ctx);
  assert.equal(v.verdict, "pass");
});

test("rule 1: wildcard SELECT is blocked with the PII reason", () => {
  const v = evaluateOperation(dbOp("SELECT * FROM users", "coupon.validator.ts"), resolvedDefault, ctx);
  assert.equal(v.verdict, "block");
  assert.equal(v.reason, "wildcard select exposes PII fields (email, phone, address, ssn)");
});

test("rule 2: DROP TABLE is blocked as destructive", () => {
  const v = evaluateOperation(dbOp("DROP TABLE users"), resolvedDefault, ctx);
  assert.equal(v.verdict, "block");
  assert.match(v.reason ?? "", /destructive/i);
});

test("rule 4: explicit PII select passes under default, rewrites under strict", () => {
  const op = dbOp("SELECT id, email FROM users");
  assert.equal(evaluateOperation(op, resolvedDefault, ctx).verdict, "pass");
  const strictVerdict = evaluateOperation(op, resolvedStrict, ctx);
  assert.equal(strictVerdict.verdict, "rewrite");
  assert.match(strictVerdict.reason ?? "", /email/);
});

test("rule 5: fs write outside scope is blocked; in-scope passes", () => {
  const outside: AgentOperation = { id: "o", kind: "fs_write", path: "./src/billing/x.ts", file: "x.ts" };
  assert.equal(evaluateOperation(outside, resolvedDefault, ctx).verdict, "block");

  const readOnly: AgentOperation = { id: "o", kind: "fs_write", path: "./src/auth/login.ts", file: "login.ts" };
  const roVerdict = evaluateOperation(readOnly, resolvedDefault, ctx);
  assert.equal(roVerdict.verdict, "block");
  assert.match(roVerdict.reason ?? "", /read-only/i);

  const inside: AgentOperation = { id: "o", kind: "fs_write", path: "./src/checkout/svc.ts", file: "svc.ts" };
  assert.equal(evaluateOperation(inside, resolvedDefault, ctx).verdict, "pass");
});

test("rule 6: known third-party host redirects to mock; unknown host blocks", () => {
  const stripe: AgentOperation = { id: "o", kind: "http_connect", host: "api.stripe.com", file: "v.ts" };
  const redirect = evaluateOperation(stripe, resolvedDefault, ctx);
  assert.equal(redirect.verdict, "rewrite");
  assert.equal(redirect.rewrittenOperation?.host, "forge-mock://stripe");

  const unmocked: AgentOperation = { id: "o", kind: "http_connect", host: "api.openai.com", file: "v.ts" };
  const blocked = evaluateOperation(unmocked, resolvedDefault, ctx);
  assert.equal(blocked.verdict, "block");
  assert.match(blocked.reason ?? "", /no mock registered/i);
});

test("resolvePolicyRules: preset → active rules + on_block", () => {
  assert.deepEqual(resolvedDefault.activeRules.includes("pii_allowlist"), false);
  assert.deepEqual(resolvedStrict.activeRules.includes("pii_allowlist"), true);
  assert.equal(resolvedDefault.onBlock, "notify_agent");
  assert.equal(resolvePolicyRules(soc2Policy).onBlock, "stop_run");
});
