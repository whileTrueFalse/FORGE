// Tests the global-fetch monkeypatch against a fake original fetch and a real
// policy: an unmocked host is blocked (rejected), a mocked host is redirected to
// the local mock URL (path preserved), and an in-scope/relative call passes
// through untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { wrapFetch, hostFromFetchInput, redirectFetchInput } from "./patchFetch.js";
import { ForgeBlockedError, type InterceptDeps } from "./intercept.js";
import { resolvePolicyRules, buildKnownMocksMap } from "../../core/policyEngine.js";
import type { AgentOperation, PolicyVerdict } from "../../types.js";

function deps(mocks: string[]): { deps: InterceptDeps; ops: AgentOperation[] } {
  const ops: AgentOperation[] = [];
  return {
    ops,
    deps: {
      policy: resolvePolicyRules({ preset: "default", rules: [], on_intercept: "rewrite", on_block: "notify_agent" }),
      ctx: { scope: "**", readOnly: [], knownMocks: buildKnownMocksMap(mocks) },
      emit: (op: AgentOperation, _v: PolicyVerdict) => ops.push(op),
    },
  };
}

const REDIRECTS = { "api.stripe.com": "http://127.0.0.1:9000" };

test("fetch: host extraction from string, URL, and Request forms", () => {
  assert.equal(hostFromFetchInput("https://api.stripe.com/v1/charges"), "api.stripe.com");
  assert.equal(hostFromFetchInput(new URL("https://api.sendgrid.com/x")), "api.sendgrid.com");
  assert.equal(hostFromFetchInput(new Request("https://api.twilio.com/m")), "api.twilio.com");
  assert.equal(hostFromFetchInput("/relative/path"), null); // no host → pass through
});

test("fetch: unmocked host is blocked (promise rejects)", async () => {
  const { deps: d } = deps([]); // no mocks registered
  let called = false;
  const original = async () => { called = true; return new Response("real"); };
  const patched = wrapFetch(original as never, d, {});
  await assert.rejects(() => patched("https://api.stripe.com/v1/charges") as Promise<unknown>, ForgeBlockedError);
  assert.equal(called, false, "the real fetch must never run for a blocked host");
});

test("fetch: mocked host is redirected to the local mock, path preserved", async () => {
  const { deps: d } = deps(["stripe"]); // stripe mocked → rewrite, not block
  let seen: unknown;
  const original = async (input: unknown) => { seen = input; return new Response("mock"); };
  const patched = wrapFetch(original as never, d, REDIRECTS);
  await patched("https://api.stripe.com/v1/charges?x=1");
  assert.equal(seen, "http://127.0.0.1:9000/v1/charges?x=1");
});

test("fetch: relative URL passes straight through", async () => {
  const { deps: d } = deps([]);
  let seen: unknown;
  const original = async (input: unknown) => { seen = input; return new Response("ok"); };
  const patched = wrapFetch(original as never, d, {});
  await patched("/health");
  assert.equal(seen, "/health");
});

test("redirectFetchInput: Request form keeps method + rewrites URL", () => {
  const out = redirectFetchInput(new Request("https://api.stripe.com/charge", { method: "POST" }), "http://127.0.0.1:9000");
  assert.ok(out instanceof Request);
  assert.equal((out as Request).url, "http://127.0.0.1:9000/charge");
  assert.equal((out as Request).method, "POST");
});
