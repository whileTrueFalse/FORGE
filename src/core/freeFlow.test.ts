import test from "node:test";
import assert from "node:assert/strict";
import { freeFlowAgent } from "./freeFlow.js";

test("freeFlowAgent: full write scope, sandbox env, no read-only", () => {
  const a = freeFlowAgent();
  assert.equal(a.scope, "**", "default agent must have full write scope");
  assert.equal(a.env, "sandbox");
  assert.deepEqual(a.read_only, []);
  assert.ok(a.name.length > 0);
  assert.ok(a.attached_at.length > 0);
});
