// Tests the mock server backend: real HTTP, preset-shaped responses, call
// recording, and the host→service redirection map. No Docker required.

import test from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "./mockServer.js";

test("mock server: stripe charge succeeds and is recorded", async () => {
  const mock = await startMockServer(["stripe"]);
  try {
    const res = await fetch(`${mock.url}/stripe/charges`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; paid: boolean };
    assert.equal(body.status, "succeeded");
    assert.equal(body.paid, true);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].service, "stripe");
    assert.equal(mock.calls[0].method, "POST");
  } finally {
    await mock.close();
  }
});

test("mock server: declined/expired path returns a card error", async () => {
  const mock = await startMockServer(["stripe"]);
  try {
    const res = await fetch(`${mock.url}/stripe/charges/declined`, { method: "POST" });
    assert.equal(res.status, 402);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "card_declined");
  } finally {
    await mock.close();
  }
});

test("mock server: sendgrid captures (202, never sends)", async () => {
  const mock = await startMockServer(["sendgrid"]);
  try {
    const res = await fetch(`${mock.url}/sendgrid/v3/mail/send`, { method: "POST" });
    assert.equal(res.status, 202);
  } finally {
    await mock.close();
  }
});

test("mock server: host map only includes registered services", async () => {
  const mock = await startMockServer(["stripe"]);
  try {
    assert.equal(mock.serviceForHost["api.stripe.com"], "stripe");
    assert.equal(mock.serviceForHost["api.sendgrid.com"], undefined);
  } finally {
    await mock.close();
  }
});
