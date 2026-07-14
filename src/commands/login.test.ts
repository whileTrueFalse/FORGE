// Unit tests for pollForAccessToken's branchy retry logic against GitHub's
// device-flow token endpoint: authorization_pending keeps polling, slow_down
// backs off, success/expired_token/access_denied terminate correctly. Stubs
// globalThis.fetch (the only external call) with tiny poll intervals so the
// suite stays fast.

import test from "node:test";
import assert from "node:assert/strict";
import { pollForAccessToken } from "./login.js";

function stubFetchSequence(responses: unknown[]) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => {
    const body = responses[Math.min(i, responses.length - 1)];
    i++;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("pollForAccessToken: succeeds immediately when GitHub returns a token", async () => {
  const restore = stubFetchSequence([{ access_token: "gho_abc" }]);
  try {
    const token = await pollForAccessToken("dc", 0, 10);
    assert.equal(token, "gho_abc");
  } finally {
    restore();
  }
});

test("pollForAccessToken: retries through authorization_pending then succeeds", async () => {
  const restore = stubFetchSequence([
    { error: "authorization_pending" },
    { error: "authorization_pending" },
    { access_token: "gho_after_wait" },
  ]);
  try {
    const token = await pollForAccessToken("dc", 0.01, 10);
    assert.equal(token, "gho_after_wait");
  } finally {
    restore();
  }
});

test("pollForAccessToken: slow_down backs off then still succeeds", async () => {
  const restore = stubFetchSequence([{ error: "slow_down" }, { access_token: "gho_slow" }]);
  try {
    const token = await pollForAccessToken("dc", 0.01, 10);
    assert.equal(token, "gho_slow");
  } finally {
    restore();
  }
});

test("pollForAccessToken: expired_token rejects with a clear message", async () => {
  const restore = stubFetchSequence([{ error: "expired_token" }]);
  try {
    await assert.rejects(() => pollForAccessToken("dc", 0, 10), /expired/i);
  } finally {
    restore();
  }
});

test("pollForAccessToken: access_denied rejects with a clear message", async () => {
  const restore = stubFetchSequence([{ error: "access_denied" }]);
  try {
    await assert.rejects(() => pollForAccessToken("dc", 0, 10), /denied/i);
  } finally {
    restore();
  }
});
