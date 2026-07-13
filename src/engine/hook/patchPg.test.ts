// Tests the real pg monkeypatch against a fake pg-shaped module: a blocked query
// never reaches the original, a rewritten query reaches it with corrected SQL,
// and a safe query passes through unchanged.

import test from "node:test";
import assert from "node:assert/strict";
import { resolvePolicyRules, buildKnownMocksMap, type PolicyEvalContext } from "../../core/policyEngine.js";
import { patchPgModule, sqlFromQueryArgs, forcePgSandboxConnection } from "./patchPg.js";
import { ForgeBlockedError, type InterceptDeps } from "./intercept.js";
import type { PolicyConfig } from "../../types.js";

function deps(): InterceptDeps {
  const policy: PolicyConfig = {
    preset: "default",
    rules: [{ pii_fields: ["email", "phone", "address", "ssn"] }],
    on_intercept: "rewrite",
    on_block: "notify_agent",
  };
  const ctx: PolicyEvalContext = { scope: "./**", readOnly: [], knownMocks: buildKnownMocksMap([]) };
  return { policy: resolvePolicyRules(policy), ctx, emit: () => {} };
}

class FakeClient {
  received: string[] = [];
  async query(...args: unknown[]): Promise<{ rows: never[] }> {
    this.received.push(sqlFromQueryArgs(args));
    return { rows: [] };
  }
}

test("sqlFromQueryArgs handles string and { text } forms", () => {
  assert.equal(sqlFromQueryArgs(["SELECT 1"]), "SELECT 1");
  assert.equal(sqlFromQueryArgs([{ text: "SELECT 2", values: [] }]), "SELECT 2");
  assert.equal(sqlFromQueryArgs([123]), "");
});

test("patched pg: blocked query never reaches the real client", async () => {
  const pg = { Client: FakeClient };
  patchPgModule(pg, deps());
  const c = new FakeClient();
  await assert.rejects(() => c.query("SELECT * FROM users"), ForgeBlockedError);
  assert.equal(c.received.length, 0);
});

test("patched pg: unscoped UPDATE reaches the client rewritten", async () => {
  class C2 extends FakeClient {}
  const pg = { Client: C2 };
  patchPgModule(pg, deps());
  const c = new C2();
  await c.query("UPDATE orders SET status = ?");
  assert.equal(c.received.at(-1), "UPDATE orders SET status = ? WHERE id = ? AND user_id = ?");
});

test("patched pg: safe query passes through unchanged", async () => {
  class C3 extends FakeClient {}
  const pg = { Client: C3 };
  patchPgModule(pg, deps());
  const c = new C3();
  await c.query("SELECT id FROM orders WHERE user_id = ?");
  assert.equal(c.received.at(-1), "SELECT id FROM orders WHERE user_id = ?");
});

test("forced pg: a hardcoded prod host is ignored and rerouted to the sandbox", () => {
  const SANDBOX = "postgres://postgres@127.0.0.1:5555/postgres";
  class RecordingClient {
    cfg: unknown;
    constructor(cfg?: unknown) { this.cfg = cfg; }
  }
  class RecordingPool {
    cfg: unknown;
    constructor(cfg?: unknown) { this.cfg = cfg; }
  }
  const pg = { Client: RecordingClient, Pool: RecordingPool } as unknown as {
    Client: new (c?: unknown) => { cfg: unknown };
    Pool: new (c?: unknown) => { cfg: unknown };
  };
  forcePgSandboxConnection(pg, SANDBOX);

  // App hardcodes a production connection — must be ignored.
  const c = new pg.Client({ host: "prod-db.internal", port: 5432, database: "prod", user: "root" });
  assert.deepEqual(c.cfg, { connectionString: SANDBOX });
  assert.ok(c instanceof RecordingClient, "forced client is still a pg Client (subclass)");

  const p = new pg.Pool({ host: "prod-db.internal" });
  assert.deepEqual(p.cfg, { connectionString: SANDBOX });
});
