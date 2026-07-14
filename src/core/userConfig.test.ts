// Tests the home-dir credential store. os.homedir() reads HOME (POSIX) /
// USERPROFILE (Windows) from the environment, so overriding both redirects it
// to a disposable temp dir for the duration of the test -- no real ~/.forge
// is ever touched.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCredentials, saveCredentials, clearCredentials } from "./userConfig.js";

test("userConfig: save/load/clear round-trip against an isolated home dir", () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "forge-home-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  try {
    // os.homedir() re-reads HOME/USERPROFILE on every call (not cached), so a
    // plain static import already resolves against whatever env is active
    // when these functions actually run.
    assert.equal(loadCredentials(), null, "no credentials yet");

    saveCredentials({ cliToken: "fgt_test", githubLogin: "octocat", tier: "free", cachedAt: "2026-01-01T00:00:00Z" });
    const loaded = loadCredentials();
    assert.equal(loaded?.githubLogin, "octocat");
    assert.equal(loaded?.cliToken, "fgt_test");

    const filePath = path.join(fakeHome, ".forge", "credentials.json");
    assert.equal(fs.existsSync(filePath), true);

    clearCredentials();
    assert.equal(loadCredentials(), null);
    assert.equal(fs.existsSync(filePath), false);

    // clearing twice must not throw
    clearCredentials();
  } finally {
    process.env.HOME = prevHome;
    process.env.USERPROFILE = prevUserProfile;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
