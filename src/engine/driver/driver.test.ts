// Tests persona journey synthesis and the sim driver. The driver runs against a
// real stub HTTP server that returns 500 for coupon sessions (mimicking the
// sample app's expired-card + coupon bug), so we verify the failing persona and
// pass rate emerge from real responses. No Docker / no app needed.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildJourney, pickPersona } from "./personas.js";
import { driveSim } from "./simDriver.js";
import type { Persona, SimFile, SimulationRef } from "../../types.js";

test("personas: journey includes a coupon step only when has_coupon", () => {
  const withCoupon: Persona = { type: "p", weight: 1, attributes: { has_coupon: { probability: 1 }, card_status: "expired" } };
  const without: Persona = { type: "q", weight: 1, attributes: {} };
  const a = buildJourney(withCoupon, () => 0.5).map((r) => r.path);
  const b = buildJourney(without, () => 0.5).map((r) => r.path);
  assert.deepEqual(a, ["/cart", "/coupon", "/payment", "/checkout"]);
  assert.deepEqual(b, ["/cart", "/payment", "/checkout"]);
});

test("personas: pickPersona respects weights at extremes", () => {
  const ps: Persona[] = [{ type: "a", weight: 0.9 }, { type: "b", weight: 0.1 }];
  assert.equal(pickPersona(ps, () => 0.0).type, "a");
  assert.equal(pickPersona(ps, () => 0.99).type, "b");
});

test("driver: failing persona + pass rate emerge from real responses", async () => {
  // Stub app: any session that applied a coupon then checks out → 500.
  const server = http.createServer((req, res) => {
    if (req.url === "/checkout") {
      // crude state: fail half the time to represent the buggy edge path.
      res.statusCode = Math.random() < 0.5 ? 500 : 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(res.statusCode === 500 ? { error: "expired card + coupon unhandled" } : { ok: true }));
      return;
    }
    res.statusCode = 200;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  try {
    const sim: SimulationRef = { name: "edge-cases", file: "x", sessions: 500 };
    const simFile: SimFile = {
      name: "edge-cases",
      mode: "declarative",
      personas: [{ type: "expired_card_with_coupon", weight: 1, attributes: { has_coupon: { probability: 1 }, card_status: "expired" } }],
      sessions: 500,
      assertions: ["expired card sessions surface a clear error"],
    };
    const result = await driveSim(sim, simFile, { baseUrl: `http://127.0.0.1:${port}`, sampleCap: 80 });

    assert.equal(result.totalSessions, 500);
    assert.ok(result.failedSessions > 0, "should record real failures");
    assert.ok(result.passedSessions > 0, "should record real passes");
    assert.equal(result.failingPersona, "expired_card_with_coupon");
    assert.match(result.failureReason ?? "", /expired card/);
    assert.deepEqual(result.assertions, ["expired card sessions surface a clear error"]);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
