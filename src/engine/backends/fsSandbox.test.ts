// Tests the FS sandbox: a temp root is created, scope rules gate writes, and
// teardown removes the root. No Docker required.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFsSandbox } from "./fsSandbox.js";

test("fs sandbox: creates a real temp root and cleans it up", async () => {
  const sb = createFsSandbox("./src/checkout/**");
  assert.equal(fs.existsSync(sb.root), true);
  await sb.teardown();
  assert.equal(fs.existsSync(sb.root), false);
});

test("fs sandbox: allows in-scope writes and denies out-of-scope / read-only", async () => {
  const sb = createFsSandbox("./src/checkout/**", ["./src/auth/**"]);
  try {
    assert.equal(sb.allows("./src/checkout/cart.ts"), true);
    assert.equal(sb.allows("./src/billing/charge.ts"), false);
    assert.equal(sb.allows("./src/auth/login.ts"), false);
  } finally {
    await sb.teardown();
  }
});
