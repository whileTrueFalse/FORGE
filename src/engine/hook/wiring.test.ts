// Tests the small wiring helpers: IPC config round-trip, and the host/path
// extractors used by the http/fs patches.

import test from "node:test";
import assert from "node:assert/strict";
import { readHookConfig, encodeHookConfig, HOOK_CONFIG_ENV } from "./ipc.js";
import { hostFromRequestArgs } from "./patchHttp.js";
import { pathFromWriteArgs } from "./patchFs.js";
import { resolvePolicyRules } from "../../core/policyEngine.js";
import type { HookConfig } from "../types.js";

test("ipc: hook config round-trips through the environment", () => {
  const config: HookConfig = {
    policy: resolvePolicyRules({ preset: "default", rules: [], on_intercept: "rewrite", on_block: "notify_agent" }),
    scope: "./src/**",
    readOnly: [],
    hostRedirects: { "api.stripe.com": "http://127.0.0.1:9000" },
    mocks: ["stripe"],
    dbUrl: "postgres://x",
  };
  const env = { [HOOK_CONFIG_ENV]: encodeHookConfig(config) } as NodeJS.ProcessEnv;
  const back = readHookConfig(env);
  assert.equal(back?.scope, "./src/**");
  assert.equal(back?.hostRedirects["api.stripe.com"], "http://127.0.0.1:9000");
  assert.equal(readHookConfig({} as NodeJS.ProcessEnv), null);
});

test("http: host extraction from url, URL, and options forms", () => {
  assert.equal(hostFromRequestArgs(["https://api.stripe.com/v1/charges"]), "api.stripe.com");
  assert.equal(hostFromRequestArgs([new URL("https://api.sendgrid.com/x")]), "api.sendgrid.com");
  assert.equal(hostFromRequestArgs([{ hostname: "api.twilio.com" }]), "api.twilio.com");
  assert.equal(hostFromRequestArgs([{ host: "example.com" }]), "example.com");
});

test("fs: path extraction from string and URL", () => {
  assert.equal(pathFromWriteArgs(["./src/x.ts"]), "./src/x.ts");
  assert.equal(pathFromWriteArgs([new URL("file:///tmp/y.ts")]), "/tmp/y.ts");
});
