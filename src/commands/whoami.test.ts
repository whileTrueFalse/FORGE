// Tests forge whoami's offline-fallback behavior: a live /me call refreshes
// the cache, but a network failure or backend outage must not crash the
// command -- it should fall back to the last cached tier.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveCredentials, loadCredentials } from "../core/userConfig.js";
import { whoami } from "./whoami.js";

// NOTE: must `await fn()` inside the try, not `return fn()` -- returning an
// unawaited promise lets `finally` run (restoring the REAL HOME/USERPROFILE)
// before the async body inside `fn` actually executes, which silently points
// every os.homedir() call in `fn` at the real home directory instead of the
// isolated one. (Caught this exact bug via a manual smoke test: it briefly
// wrote this test's fake credentials into the real ~/.forge/ -- cleaned up.)
async function withIsolatedHome<T>(fn: (fakeHome: string) => Promise<T>): Promise<T> {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "forge-home-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  try {
    return await fn(fakeHome);
  } finally {
    process.env.HOME = prevHome;
    process.env.USERPROFILE = prevUserProfile;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
}

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  return { lines, restore: () => (console.log = original) };
}

test("whoami: not signed in prints a clear message and does not throw", async () => {
  await withIsolatedHome(async () => {
    const { lines, restore } = captureLogs();
    try {
      await whoami();
      assert.ok(lines.some((l) => /not signed in/i.test(l)));
    } finally {
      restore();
    }
  });
});

test("whoami: refreshes from a live /me call and updates the cache", async () => {
  await withIsolatedHome(async (fakeHome) => {
    saveCredentials({ cliToken: "fgt_x", githubLogin: "old-login", tier: "free", cachedAt: "2020-01-01T00:00:00Z" });
    // Proves isolation actually held (not just that the returned value looks
    // right) -- this exact assertion is what would have caught the bug where
    // the async body silently ran against the real home directory instead.
    assert.equal(fs.existsSync(path.join(fakeHome, ".forge", "credentials.json")), true);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ githubLogin: "old-login", tier: "pro" }), { status: 200 })) as typeof fetch;
    const { lines, restore } = captureLogs();
    try {
      await whoami();
      assert.ok(lines.some((l) => /pro tier/.test(l)));
      assert.equal(loadCredentials()?.tier, "pro", "the cache should be updated from the live response");
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });
});

test("whoami: falls back to the cache when the backend is unreachable", async () => {
  await withIsolatedHome(async () => {
    saveCredentials({ cliToken: "fgt_x", githubLogin: "octocat", tier: "pro", cachedAt: "2020-01-01T00:00:00Z" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network unreachable");
    }) as typeof fetch;
    const { lines, restore } = captureLogs();
    try {
      await whoami();
      assert.ok(lines.some((l) => /octocat.*pro tier/.test(l)));
      assert.ok(lines.some((l) => /cached/i.test(l)), "must indicate the data is stale/cached");
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });
});
