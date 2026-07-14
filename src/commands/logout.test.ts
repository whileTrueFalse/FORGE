// Tests forge logout: local credentials are cleared even when the backend
// revoke call fails (network down, backend outage) -- a signed-out CLI must
// never be stuck "logged in" locally just because the server is unreachable.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveCredentials, loadCredentials } from "../core/userConfig.js";
import { logout } from "./logout.js";

// NOTE: must `await fn()` inside the try -- see whoami.test.ts for why an
// unawaited `return fn()` breaks the isolation (finally restores the real
// HOME before the async body runs).
async function withIsolatedHome<T>(fn: () => Promise<T>): Promise<T> {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "forge-home-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  try {
    return await fn();
  } finally {
    process.env.HOME = prevHome;
    process.env.USERPROFILE = prevUserProfile;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
}

test("logout: clears local credentials even when the backend is unreachable", async () => {
  await withIsolatedHome(async () => {
    saveCredentials({ cliToken: "fgt_x", githubLogin: "octocat", tier: "free", cachedAt: "2020-01-01T00:00:00Z" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network unreachable");
    }) as typeof fetch;
    try {
      await logout();
      assert.equal(loadCredentials(), null, "local credentials must be cleared regardless of network state");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("logout: is a no-op (no throw) when already signed out", async () => {
  await withIsolatedHome(async () => {
    await logout(); // must not throw
    assert.equal(loadCredentials(), null);
  });
});
